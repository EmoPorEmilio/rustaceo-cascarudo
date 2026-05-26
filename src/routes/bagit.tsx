import { createFileRoute } from '@tanstack/solid-router';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import {
  createBag,
  createBagitInputFiles,
  validateBag,
  type BagitMode,
  type BagitProgress,
  type BagitValidation,
  type FileSelection,
} from '../app/bagit/wasm';
import bagitCss from '../styles/bagit.css?url';

type DownloadState = {
  url: string;
  fileName: string;
  size: number;
};

type RunState = 'idle' | 'running' | 'complete' | 'error';

type FileSystemEntryLike = {
  name: string;
  fullPath: string;
  isFile: boolean;
  isDirectory: boolean;
};

type FileSystemFileEntryLike = FileSystemEntryLike & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};

type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  createReader: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      error?: (error: DOMException) => void,
    ) => void;
  };
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntryLike | null;
};

export const Route = createFileRoute('/bagit')({
  head: () => ({
    meta: [
      { title: 'BagIt - Rustaceo Cascarudo' },
      {
        name: 'description',
        content: 'Bag and validate BagIt archives in the browser.',
      },
    ],
    links: [{ rel: 'stylesheet', href: bagitCss }],
  }),
  component: BagitPage,
});

function BagitPage() {
  const [mode, setMode] = createSignal<BagitMode>('bag');
  const [files, setFiles] = createSignal<FileSelection[]>([]);
  const [dragActive, setDragActive] = createSignal(false);
  const [runState, setRunState] = createSignal<RunState>('idle');
  const [message, setMessage] = createSignal('');
  const [progress, setProgress] = createSignal<Record<string, BagitProgress>>({});
  const [download, setDownload] = createSignal<DownloadState | null>(null);
  const [validation, setValidation] = createSignal<BagitValidation | null>(null);

  let fileInput: HTMLInputElement | undefined;
  let folderInput: HTMLInputElement | undefined;

  const totalBytes = createMemo(() => files().reduce((sum, item) => sum + item.file.size, 0));
  const streamedBytes = createMemo(() =>
    Object.values(progress()).reduce((sum, item) => sum + item.loaded, 0),
  );
  const progressValue = createMemo(() => {
    const total = totalBytes();
    if (!total) return 0;
    return Math.min(100, Math.round((streamedBytes() / total) * 100));
  });
  const canRun = createMemo(() => files().length > 0 && runState() !== 'running');

  onCleanup(() => {
    const currentDownload = download();
    if (currentDownload) URL.revokeObjectURL(currentDownload.url);
  });

  function setNextMode(nextMode: BagitMode) {
    setMode(nextMode);
    clearRunOutput();
  }

  function clearRunOutput() {
    const currentDownload = download();
    if (currentDownload) URL.revokeObjectURL(currentDownload.url);
    setDownload(null);
    setValidation(null);
    setMessage('');
    setProgress({});
    setRunState('idle');
  }

  function replaceFiles(nextFiles: readonly FileSelection[]) {
    clearRunOutput();
    setFiles(dedupeSelections(nextFiles));
  }

  function addFiles(nextFiles: readonly FileSelection[]) {
    clearRunOutput();
    setFiles((current) => dedupeSelections([...current, ...nextFiles]));
  }

  async function run() {
    if (!canRun()) return;

    clearRunOutput();
    setRunState('running');
    setMessage(mode() === 'bag' ? 'Bagging' : 'Validating');

    const wasmFiles = createBagitInputFiles(files(), (nextProgress) => {
      setProgress((current) => ({
        ...current,
        [nextProgress.path]: nextProgress,
      }));
    });

    try {
      if (mode() === 'bag') {
        const result = await createBag(wasmFiles);
        const url = URL.createObjectURL(result.blob);
        setDownload({ url, fileName: result.fileName, size: result.blob.size });
        setMessage('Bag ready');
      } else {
        const result = await validateBag(wasmFiles);
        setValidation(result);
        setMessage(result.message);
      }

      setRunState('complete');
    } catch (error) {
      setRunState('error');
      setMessage(error instanceof Error ? error.message : 'BagIt operation failed.');
    }
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragActive(false);

    if (!event.dataTransfer) return;
    const droppedFiles = await readDataTransferFiles(event.dataTransfer);
    if (droppedFiles.length) replaceFiles(droppedFiles);
  }

  function handleFileInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    addFiles(fileListToSelections(input.files));
    input.value = '';
  }

  function handleFolderInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    addFiles(fileListToSelections(input.files));
    input.value = '';
  }

  function removeFile(path: string) {
    clearRunOutput();
    setFiles((current) => current.filter((item) => item.path !== path));
  }

  return (
    <main class="bagit-shell">
      <input
        ref={(element) => {
          fileInput = element;
        }}
        class="bagit-hidden-input"
        type="file"
        multiple
        onChange={handleFileInput}
      />
      <input
        ref={(element) => {
          folderInput = element;
          element.setAttribute('webkitdirectory', '');
        }}
        class="bagit-hidden-input"
        type="file"
        multiple
        onChange={handleFolderInput}
      />

      <section class="bagit-workspace" aria-labelledby="bagit-title">
        <header class="bagit-header">
          <a class="bagit-brand" href="/" aria-label="Rustaceo Cascarudo home">
            <img src="/logotipo.svg" alt="" />
          </a>
          <div class="bagit-title-block">
            <p class="bagit-kicker">Rustaceo Cascarudo</p>
            <h1 id="bagit-title">BagIt</h1>
          </div>
          <div class="bagit-mode" role="tablist" aria-label="BagIt mode">
            <button
              type="button"
              classList={{ active: mode() === 'bag' }}
              aria-selected={mode() === 'bag'}
              role="tab"
              onClick={() => setNextMode('bag')}
            >
              Bag
            </button>
            <button
              type="button"
              classList={{ active: mode() === 'validate' }}
              aria-selected={mode() === 'validate'}
              role="tab"
              onClick={() => setNextMode('validate')}
            >
              Validate
            </button>
          </div>
        </header>

        <div class="bagit-main">
          <section
            class="bagit-dropzone"
            classList={{ active: dragActive() }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <div class="bagit-dropmark" aria-hidden="true">
              {mode() === 'bag' ? 'B' : 'V'}
            </div>
            <div>
              <h2>{mode() === 'bag' ? 'Create bag' : 'Validate bag'}</h2>
              <p>{files().length ? selectedSummary(files()) : 'Drop files here'}</p>
            </div>
            <div class="bagit-actions">
              <button
                type="button"
                onClick={() => fileInput?.click()}
                disabled={runState() === 'running'}
              >
                Choose files
              </button>
              <button
                type="button"
                onClick={() => folderInput?.click()}
                disabled={runState() === 'running'}
              >
                Choose folder
              </button>
            </div>
          </section>

          <aside class="bagit-panel" aria-label="Run">
            <div class="bagit-run-header">
              <span>{files().length} files</span>
              <span>{formatBytes(totalBytes())}</span>
            </div>

            <div class="bagit-progress">
              <div style={{ width: `${runState() === 'running' ? progressValue() : 0}%` }} />
            </div>

            <button type="button" class="bagit-run-button" disabled={!canRun()} onClick={run}>
              {runState() === 'running' ? 'Working' : mode() === 'bag' ? 'Bag' : 'Validate'}
            </button>

            <Show when={message()}>
              <p class={`bagit-message ${runState()}`}>{message()}</p>
            </Show>

            <Show when={download()}>
              {(currentDownload) => (
                <a
                  class="bagit-download"
                  href={currentDownload().url}
                  download={currentDownload().fileName}
                >
                  Download bag
                  <span>{formatBytes(currentDownload().size)}</span>
                </a>
              )}
            </Show>

            <Show when={validation()}>
              {(currentValidation) => (
                <div
                  class="bagit-validation"
                  classList={{
                    valid: currentValidation().valid,
                    invalid: !currentValidation().valid,
                  }}
                >
                  <strong>{currentValidation().valid ? 'Valid' : 'Invalid'}</strong>
                  <Show when={currentValidation().errors.length}>
                    <ul>
                      <For each={currentValidation().errors}>{(error) => <li>{error}</li>}</For>
                    </ul>
                  </Show>
                  <Show when={currentValidation().warnings.length}>
                    <ul>
                      <For each={currentValidation().warnings}>
                        {(warning) => <li>{warning}</li>}
                      </For>
                    </ul>
                  </Show>
                </div>
              )}
            </Show>
          </aside>
        </div>

        <section class="bagit-file-list" aria-label="Queued files">
          <div class="bagit-file-list-header">
            <h2>Queued files</h2>
            <button
              type="button"
              onClick={() => replaceFiles([])}
              disabled={!files().length || runState() === 'running'}
            >
              Clear
            </button>
          </div>

          <Show when={files().length} fallback={<p class="bagit-empty">No files queued</p>}>
            <div class="bagit-files">
              <For each={files()}>
                {(item) => (
                  <article class="bagit-file">
                    <div>
                      <strong title={item.path}>{item.path}</strong>
                      <span>{formatBytes(item.file.size)}</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${item.path}`}
                      onClick={() => removeFile(item.path)}
                      disabled={runState() === 'running'}
                    >
                      x
                    </button>
                  </article>
                )}
              </For>
            </div>
          </Show>
        </section>
      </section>
    </main>
  );
}

function fileListToSelections(fileList: FileList | null): FileSelection[] {
  if (!fileList) return [];

  return Array.from(fileList).map((file) => ({
    file,
    path: normalizePath(file.webkitRelativePath || file.name),
  }));
}

async function readDataTransferFiles(dataTransfer: DataTransfer) {
  const entries = Array.from(dataTransfer.items)
    .map(readTransferEntry)
    .filter((entry): entry is FileSystemEntryLike => entry !== null);

  if (entries.length) {
    const nested = await Promise.all(entries.map((entry) => readEntryFiles(entry, '')));
    return nested.flat();
  }

  return fileListToSelections(dataTransfer.files);
}

function readTransferEntry(item: DataTransferItem) {
  return ((item as DataTransferItemWithEntry).webkitGetAsEntry?.() ??
    null) as FileSystemEntryLike | null;
}

async function readEntryFiles(
  entry: FileSystemEntryLike,
  parentPath: string,
): Promise<FileSelection[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntryLike);
    return [
      {
        file,
        path: normalizePath(`${parentPath}${entry.name}`),
      },
    ];
  }

  if (entry.isDirectory) {
    const directory = entry as FileSystemDirectoryEntryLike;
    const children = await readDirectoryEntries(directory);
    const basePath = `${parentPath}${entry.name}/`;
    const nested = await Promise.all(children.map((child) => readEntryFiles(child, basePath)));
    return nested.flat();
  }

  return [];
}

function readFileEntry(entry: FileSystemFileEntryLike) {
  return new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(entry: FileSystemDirectoryEntryLike) {
  const reader = entry.createReader();
  const allEntries: FileSystemEntryLike[] = [];

  return new Promise<FileSystemEntryLike[]>((resolve, reject) => {
    function readBatch() {
      reader.readEntries((entries) => {
        if (!entries.length) {
          resolve(allEntries);
          return;
        }

        allEntries.push(...entries);
        readBatch();
      }, reject);
    }

    readBatch();
  });
}

function dedupeSelections(selections: readonly FileSelection[]) {
  const map = new Map<string, FileSelection>();
  for (const selection of selections) {
    const key = `${selection.path}:${selection.file.size}:${selection.file.lastModified}`;
    map.set(key, selection);
  }

  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizePath(path: string) {
  return path.replace(/^\/+/, '').replaceAll('\\', '/');
}

function selectedSummary(selections: readonly FileSelection[]) {
  return `${selections.length} files - ${formatBytes(
    selections.reduce((sum, item) => sum + item.file.size, 0),
  )}`;
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
