/**
 * Carrying this browser's data across the rename from `browser-md` to
 * `localmd`.
 *
 * The names being retired were never user-visible — they are storage keys and
 * an IndexedDB database — but the data under them very much is: settings, API
 * keys, the licence, folder handles, and every saved chat. Renaming without
 * this module would not lose that data so much as hide it: it would still be
 * sitting in the origin under a name nothing reads any more, which looks
 * exactly like a wipe to the person it happened to.
 *
 * So the move is a copy, and the old names are left in place. Deleting them is
 * a separate, later, deliberate act — there is nothing to gain from doing it in
 * the same release that introduces the code which might get the copy wrong.
 * (Retire them once a build carrying this has been live long enough that no
 * browser is still arriving with only the old names — after 2026-11.)
 *
 * It runs on IMPORT, not on call, and main.ts imports it first for its side
 * effect. That is not a style choice: an ES module's imports are all evaluated
 * before any statement in its body, and i18n/index.ts reads the saved locale —
 * and writes back a default — while it is being imported. A migration invoked
 * from main.ts's body would arrive after that write, find `localmd:locale`
 * already set, skip it as "this browser's current value", and quietly drop a
 * saved choice. Anything else that reads storage at module scope has the same
 * shape of problem; running first is the only ordering that has none of them.
 *
 * The IndexedDB half lives in lib/idb.ts, where it can gate the first open.
 */

const OLD_PREFIX = 'browser-md:'
const NEW_PREFIX = 'localmd:'

/**
 * Copy every `browser-md:*` key to its `localmd:*` name, unless that name is
 * already taken — a value written under the new name is this browser's current
 * one, and must never be overwritten by the snapshot it was migrated from.
 *
 * Keys are collected before anything is written: `setItem` may append to the
 * store, and an index-based walk that writes as it goes can skip entries.
 */
export function adoptLegacyLocalStorage(): void {
  try {
    const legacy: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(OLD_PREFIX)) legacy.push(key)
    }
    for (const key of legacy) {
      const renamed = NEW_PREFIX + key.slice(OLD_PREFIX.length)
      if (localStorage.getItem(renamed) !== null) continue
      const value = localStorage.getItem(key)
      if (value !== null) localStorage.setItem(renamed, value)
    }
  } catch {
    // Private mode, or storage denied. Nothing to carry over, and refusing to
    // start over a failed copy would be worse than starting fresh.
  }
}

adoptLegacyLocalStorage()
