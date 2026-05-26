export type BagitMode = 'bag' | 'validate';

export type BagitProgress = {
  path: string;
  loaded: number;
  total: number;
};

export type BagitInputFile = {
  path: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  stream: () => Promise<ReadableStream<Uint8Array>>;
};

export type BagitValidation = {
  valid: boolean;
  message: string;
  errors: readonly string[];
  warnings: readonly string[];
};

export type BagitDownload = {
  fileName: string;
  blob: Blob;
};

type BagrWasmModule = {
  default: (moduleOrPath?: unknown) => Promise<unknown>;
  BagBuilder: new () => {
    build: (source: unknown, sink: unknown, options: unknown) => Promise<unknown>;
  };
  Validator: new () => {
    validate: (source: unknown, options: unknown) => Promise<BagrValidationReport>;
  };
};

type BagrValidationReport = {
  payload_files?: number;
  payload_octets?: number;
  payload_manifests?: unknown[];
  tag_manifests?: unknown[];
  held_files?: number;
};

type BagSource = {
  list: () => Promise<string[]>;
  size: (path: string) => Promise<number>;
  open: (path: string) => Promise<BagReader>;
};

type BagReader = {
  next: () => Promise<{ done: true } | { done: false; value: Uint8Array }>;
};

type MemorySink = {
  files: Map<string, Uint8Array>;
  create: (path: string) => Promise<BagWriter>;
};

type BagWriter = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

const bagName = 'rustaceo-cascarudo-bag';
const zipMimeType = 'application/zip';
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
let bagrWasmPromise: Promise<BagrWasmModule> | undefined;
let crcTable: Uint32Array | undefined;

export function createBagitInputFiles(
  files: readonly FileSelection[],
  onProgress: (progress: BagitProgress) => void,
): BagitInputFile[] {
  assertBrowserRuntime();

  return files.map(({ file, path }) => ({
    path,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    stream: async () => createTrackedStream(file, path, onProgress),
  }));
}

export async function createBag(files: readonly BagitInputFile[]): Promise<BagitDownload> {
  assertBrowserRuntime();
  assertFilesSelected(files);

  const { BagBuilder } = await loadBagrWasm();
  const source = createFileSource(files);
  const sink = createMemorySink();

  await new BagBuilder().build(source, sink, {
    bagging_date: new Date().toISOString().slice(0, 10),
    software_agent: 'Rustaceo Cascarudo / bagr-wasm',
  });

  return {
    fileName: `${bagName}.zip`,
    blob: createZipBlob(sink.files, bagName),
  };
}

export async function validateBag(files: readonly BagitInputFile[]): Promise<BagitValidation> {
  assertBrowserRuntime();
  assertFilesSelected(files);

  const { Validator } = await loadBagrWasm();
  const source = await createValidationSource(files);

  try {
    const report = await new Validator().validate(source, { fast: false });
    return {
      valid: true,
      message: validationSummary(report),
      errors: [],
      warnings: [],
    };
  } catch (error) {
    return {
      valid: false,
      message: 'Invalid bag',
      errors: [errorMessage(error)],
      warnings: [],
    };
  }
}

export type FileSelection = {
  file: File;
  path: string;
};

function assertBrowserRuntime() {
  if (typeof window === 'undefined') {
    throw new Error('BagIt operations are client-side only.');
  }
}

function createTrackedStream(
  file: File,
  path: string,
  onProgress: (progress: BagitProgress) => void,
) {
  let loaded = 0;
  const total = file.size;

  return file.stream().pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        onProgress({ path, loaded, total });
        controller.enqueue(chunk);
      },
      flush() {
        onProgress({ path, loaded: total, total });
      },
    }),
  );
}

async function loadBagrWasm() {
  if (!bagrWasmPromise) {
    bagrWasmPromise = import('./wasm-pkg/bagr_wasm.js').then(async (module) => {
      const bagr = module as BagrWasmModule;
      await bagr.default();
      return bagr;
    });
  }

  return await bagrWasmPromise;
}

function assertFilesSelected(files: readonly BagitInputFile[]) {
  if (!files.length) {
    throw new Error('Select files before running BagIt.');
  }
}

function createFileSource(files: readonly BagitInputFile[]): BagSource {
  const byPath = new Map<string, BagitInputFile>();

  for (const file of files) {
    const path = normalizeSourcePath(file.path);
    if (!path) throw new Error('A selected file has an empty path.');
    if (byPath.has(path)) throw new Error(`Duplicate BagIt path: ${path}`);
    byPath.set(path, { ...file, path });
  }

  return {
    async list() {
      return Array.from(byPath.keys());
    },
    async size(path) {
      const file = byPath.get(path);
      if (!file) throw new Error(`Missing file: ${path}`);
      return file.size;
    },
    async open(path) {
      const file = byPath.get(path);
      if (!file) throw new Error(`Missing file: ${path}`);
      const reader = (await file.stream()).getReader();

      return {
        async next() {
          const result = await reader.read();
          if (result.done) {
            reader.releaseLock();
            return { done: true };
          }

          return { done: false, value: result.value };
        },
      };
    },
  };
}

async function createValidationSource(files: readonly BagitInputFile[]): Promise<BagSource> {
  if (files.length === 1 && isZipCandidate(files[0])) {
    const bytes = await readInputFileBytes(files[0]);
    if (hasZipMagic(bytes)) return createBytesSource(await readZipEntries(bytes));
  }

  return createFileSource(stripCommonBagRoot(files));
}

function createBytesSource(rawFiles: Map<string, Uint8Array>): BagSource {
  const files = stripCommonBagRootFromMap(rawFiles);

  return {
    async list() {
      return Array.from(files.keys());
    },
    async size(path) {
      const file = files.get(path);
      if (!file) throw new Error(`Missing file: ${path}`);
      return file.byteLength;
    },
    async open(path) {
      const file = files.get(path);
      if (!file) throw new Error(`Missing file: ${path}`);
      let done = false;

      return {
        async next() {
          if (done) return { done: true };
          done = true;
          return { done: false, value: file };
        },
      };
    },
  };
}

function createMemorySink(): MemorySink {
  const files = new Map<string, Uint8Array>();

  return {
    files,
    async create(path) {
      const chunks: Uint8Array[] = [];

      return {
        async write(chunk) {
          chunks.push(Uint8Array.from(chunk));
        },
        async close() {
          files.set(normalizeSourcePath(path), concatUint8Arrays(chunks));
        },
      };
    },
  };
}

function createZipBlob(files: ReadonlyMap<string, Uint8Array>, rootName: string) {
  const entries = Array.from(files.entries())
    .map(([path, data]) => ({
      path: `${rootName}/${normalizeSourcePath(path)}`,
      data,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const { date, time } = dosTimestamp(new Date());
  let offset = 0;

  for (const entry of entries) {
    const pathBytes = utf8Encoder.encode(entry.path);
    assertZip32(pathBytes.length, 'ZIP file name');
    assertZip32(entry.data.byteLength, entry.path);

    const crc = crc32(entry.data);
    const localOffset = offset;
    const localHeader = new Uint8Array(30 + pathBytes.length);
    writeZipLocalHeader(localHeader, pathBytes, entry.data.byteLength, crc, time, date);
    localParts.push(localHeader, entry.data);
    offset += localHeader.byteLength + entry.data.byteLength;

    const centralHeader = new Uint8Array(46 + pathBytes.length);
    writeZipCentralHeader(
      centralHeader,
      pathBytes,
      entry.data.byteLength,
      crc,
      time,
      date,
      localOffset,
    );
    centralParts.push(centralHeader);
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  assertZip32(centralOffset, 'ZIP central directory offset');
  assertZip32(centralSize, 'ZIP central directory size');
  if (entries.length > 0xffff) throw new Error('ZIP64 bag archives are not supported.');

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);

  return new Blob([...localParts, ...centralParts, end].map(toBlobPart), { type: zipMimeType });
}

async function readZipEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const files = new Map<string, Uint8Array>();
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Invalid ZIP central directory.');
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('Encrypted ZIP bag archives are not supported.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('ZIP64 bag archives are not supported.');
    }
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid ZIP local header for ${name}.`);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const data =
      method === 0
        ? Uint8Array.from(compressed)
        : method === 8
          ? await inflateRaw(compressed)
          : unsupportedZipMethod(method, name);

    if (data.byteLength !== uncompressedSize) {
      throw new Error(`Unexpected uncompressed size for ${name}.`);
    }
    if (crc32(data) !== expectedCrc) {
      throw new Error(`Checksum mismatch in ZIP entry ${name}.`);
    }

    const path = normalizeSourcePath(name);
    if (isUsableZipPath(path)) files.set(path, data);
  }

  return files;
}

function writeZipLocalHeader(
  buffer: Uint8Array,
  pathBytes: Uint8Array,
  size: number,
  crc: number,
  time: number,
  date: number,
) {
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, pathBytes.length, true);
  buffer.set(pathBytes, 30);
}

function writeZipCentralHeader(
  buffer: Uint8Array,
  pathBytes: Uint8Array,
  size: number,
  crc: number,
  time: number,
  date: number,
  localOffset: number,
) {
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, pathBytes.length, true);
  view.setUint32(42, localOffset, true);
  buffer.set(pathBytes, 46);
}

function findEndOfCentralDirectory(view: DataView) {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }

  throw new Error('Selected file is not a ZIP archive.');
}

async function inflateRaw(bytes: Uint8Array) {
  const Decompression = globalThis.DecompressionStream as
    | (new (format: string) => TransformStream<Uint8Array, Uint8Array>)
    | undefined;

  if (!Decompression) {
    throw new Error('Deflated ZIP bag archives are not supported in this browser.');
  }

  const stream = new Blob([toBlobPart(bytes)])
    .stream()
    .pipeThrough(new Decompression('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unsupportedZipMethod(method: number, name: string): never {
  throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
}

async function readInputFileBytes(file: BagitInputFile) {
  return new Uint8Array(await new Response(await file.stream()).arrayBuffer());
}

function hasZipMagic(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isZipCandidate(file: BagitInputFile) {
  return (
    file.path.toLowerCase().endsWith('.zip') ||
    file.name.toLowerCase().endsWith('.zip') ||
    file.type === zipMimeType ||
    file.type === 'application/x-zip-compressed'
  );
}

function stripCommonBagRoot(files: readonly BagitInputFile[]) {
  const paths = files.map((file) => normalizeSourcePath(file.path));
  const root = commonBagRoot(paths);
  return files.map((file, index) => ({
    ...file,
    path: root ? paths[index].slice(root.length) : paths[index],
  }));
}

function stripCommonBagRootFromMap(rawFiles: ReadonlyMap<string, Uint8Array>) {
  const entries = Array.from(rawFiles.entries())
    .map(([path, data]) => [normalizeSourcePath(path), data] as const)
    .filter(([path]) => isUsableZipPath(path));
  const root = commonBagRoot(entries.map(([path]) => path));
  const files = new Map<string, Uint8Array>();

  for (const [path, data] of entries) {
    files.set(root ? path.slice(root.length) : path, data);
  }

  return files;
}

function commonBagRoot(paths: readonly string[]) {
  if (paths.includes('bagit.txt')) return '';

  const bagitPath = paths.find((path) => path.endsWith('/bagit.txt'));
  if (!bagitPath) return '';

  const root = bagitPath.slice(0, -'bagit.txt'.length);
  return root && paths.every((path) => path.startsWith(root)) ? root : '';
}

function normalizeSourcePath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/^\.\//, '');
}

function isUsableZipPath(path: string) {
  if (!path || path.endsWith('/')) return false;
  if (path.startsWith('__MACOSX/')) return false;
  if (path.split('/').some((part) => part === '..')) return false;
  return true;
}

function validationSummary(report: BagrValidationReport) {
  const files = typeof report.payload_files === 'number' ? report.payload_files : 0;
  const octets = typeof report.payload_octets === 'number' ? report.payload_octets : 0;
  return `Valid bag: ${files} payload ${files === 1 ? 'file' : 'files'}, ${formatBytes(octets)}.`;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function concatUint8Arrays(chunks: readonly Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function decodeZipName(bytes: Uint8Array, flags: number) {
  if (flags & 0x0800) return utf8Decoder.decode(bytes);
  return utf8Decoder.decode(bytes);
}

function dosTimestamp(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function crc32(bytes: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getCrcTable() {
  if (crcTable) return crcTable;

  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crcTable = table;
  return table;
}

function assertZip32(value: number, label: string) {
  if (value > 0xffffffff) {
    throw new Error(`${label} is too large for ZIP32.`);
  }
}

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
