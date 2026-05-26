/* tslint:disable */
/* eslint-disable */

/**
 * Service: build a new bag.
 */
export class BagBuilder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Assemble a bag in `sink` from payload files in `source`.
     *
     * `options` keys (all optional):
     * - `algorithms`: `string[]` (subset of `["md5","sha256","sha512"]`).
     * - `bag_info`: `{ [key: string]: string | string[] }`.
     * - `bagging_date`: `string` (e.g. `"2026-05-26"`). wasm has no clock,
     *   so pass `new Date().toISOString().slice(0,10)` from JS.
     * - `software_agent`: `string`.
     * - `include_tag_manifests`: `bool` (default true).
     */
    build(source: any, sink: any, options: any): Promise<any>;
    constructor();
}

/**
 * Service: validate an existing bag.
 */
export class Validator {
    free(): void;
    [Symbol.dispose](): void;
    constructor();
    /**
     * Validate `source` (a JS object implementing the source contract).
     *
     * `options` may be omitted or `{ fast?: bool, completeness_only?: bool }`.
     * Resolves to a `{ payload_files, payload_octets, payload_manifests,
     * tag_manifests, held_files }` object.
     */
    validate(source: any, options: any): Promise<any>;
}

export function bagit_version(): string;

export function init(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_bagbuilder_free: (a: number, b: number) => void;
    readonly bagbuilder_build: (a: number, b: any, c: any, d: any) => any;
    readonly bagbuilder_new: () => number;
    readonly bagit_version: () => [number, number];
    readonly init: () => void;
    readonly validator_validate: (a: number, b: any, c: any) => any;
    readonly validator_new: () => number;
    readonly __wbg_validator_free: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h255d481cacfcabc7: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__hda64989e521bcbbd: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
