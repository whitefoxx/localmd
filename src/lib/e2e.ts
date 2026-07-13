/** E2E test mode (?e2e in the URL): the app must run FULLY isolated —
 *  never read or write the user's real localStorage/IndexedDB state.
 *  (Hard-learned: the bootstrap once persisted the mock profile through the
 *  settings watcher and clobbered the user's real API keys.) */
export function isE2eMode(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e')
}
