/**
 * Feature-detected shims for built-ins that pdf.js 6 assumes.
 *
 * pdf.js computes a document's fingerprint with `Uint8Array.prototype.toHex()`
 * — shipped in Chrome 140 / Safari 18.2 / Firefox 133 — so on anything older
 * *every* `getDocument()` rejects with "a.toHex is not a function" and no PDF
 * can be indexed. The throw happens inside the pdf.js worker, which has its own
 * global scope: `installJsShims` must therefore stay self-contained (globals
 * only — no imports, no closure over module state) so `jsShimSource()` can
 * stringify it and prepend it to the worker (see docindex/pdf/extract.ts).
 *
 * Every shim is a no-op on a browser that already has the built-in.
 */

/**
 * Whether this runtime is missing any of the shimmed built-ins. Captured at
 * module load — before `installJsShims()` can mask the answer — so callers that
 * only need the shims conditionally (the worker wrapper) can still ask.
 */
const SHIMS_NEEDED = [
  (Uint8Array.prototype as unknown as Record<string, unknown>).toHex,
  (Uint8Array.prototype as unknown as Record<string, unknown>).toBase64,
  (Uint8Array as unknown as Record<string, unknown>).fromBase64,
  (Promise as unknown as Record<string, unknown>).try,
  (Promise as unknown as Record<string, unknown>).withResolvers,
].some((v) => typeof v !== 'function')

export function jsShimsNeeded(): boolean {
  return SHIMS_NEEDED
}

export function installJsShims(): void {
  const define = (target: object, name: string, value: unknown): void => {
    if (typeof (target as Record<string, unknown>)[name] === 'function') return
    Object.defineProperty(target, name, { value, writable: true, configurable: true })
  }

  define(Uint8Array.prototype, 'toHex', function toHex(this: Uint8Array): string {
    let out = ''
    for (let i = 0; i < this.length; i++) out += this[i].toString(16).padStart(2, '0')
    return out
  })

  define(Uint8Array.prototype, 'toBase64', function toBase64(this: Uint8Array): string {
    // Chunked: String.fromCharCode(...big) blows the argument stack.
    let bin = ''
    for (let i = 0; i < this.length; i += 0x8000) {
      bin += String.fromCharCode(...this.subarray(i, i + 0x8000))
    }
    return btoa(bin)
  })

  define(Uint8Array, 'fromBase64', function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  })

  define(Promise, 'try', function tryCall(fn: (...a: unknown[]) => unknown, ...args: unknown[]) {
    return new Promise((resolve) => resolve(fn(...args)))
  })

  define(Promise, 'withResolvers', function withResolvers() {
    let resolve!: (value: unknown) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  })
}

/** The same shims as source text, for injection into a worker's global scope. */
export function jsShimSource(): string {
  // Semicolon-wrapped: this gets concatenated with other source, and a leading
  // `(` after an unterminated statement would be parsed as a call.
  return `;(${installJsShims.toString()})();`
}
