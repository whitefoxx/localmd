/**
 * Outward-facing addresses, in one place.
 *
 * Not a config file — these are compiled constants. They live together because
 * each of them appears in several surfaces (the help panel, the landing page,
 * the manual), and a link that is right in three places and stale in the fourth
 * is worse than one that is wrong everywhere: nobody notices.
 *
 * If you deploy your own copy, this is the file to point somewhere else.
 */

/** Issue tracker: this repository's own, so a report lands where the people
 *  who could fix it already are. */
export const FEEDBACK_URL = 'https://github.com/whitefoxx/localmd/issues'

/** Where the code is. A fork that deploys its own build should point this at
 *  itself — the landing page and the help panel both read it. */
export const SOURCE_URL = 'https://github.com/whitefoxx/localmd'

/** localmd Connect on the Chrome Web Store — listed 2026-08. The landing page
 *  and the tool catalog both point here; one fact, one place.
 *
 *  It is free, and it talks to whatever origin you authorize in it, so a copy
 *  you host yourself works with it once you add your own address to its list. */
export const CONNECT_STORE_URL =
  'https://chromewebstore.google.com/detail/localmd-connect-browser-s/bgennbocoapjiiolmmlcbfingimhmchh'
