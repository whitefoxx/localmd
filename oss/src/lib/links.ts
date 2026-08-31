/**
 * Outward-facing addresses, in one place.
 *
 * Not a config file — these are compiled constants. They live together because
 * each of them appears in several surfaces (the help panel, the landing page,
 * the manual), and a link that is right in three places and stale in the fourth
 * is worse than one that is wrong everywhere: nobody notices.
 *
 * Where reports go is an edition's own fact, not the software's. This build
 * sends them to the repository it was built from, because that is where the
 * people who could fix them are. If you deploy your own, this is the file to
 * point somewhere else.
 */

/** Issue tracker: this repository's own. */
export const FEEDBACK_URL = 'https://github.com/whitefoxx/localmd/issues'

/** Where the code is. The same address in both editions today — a fork that
 *  deploys its own build should point this at itself, which is the whole reason
 *  this file is the edition's and not the app's. */
export const SOURCE_URL = 'https://github.com/whitefoxx/localmd'

/** localmd Connect on the Chrome Web Store — listed 2026-08.
 *
 *  Published under the hosted service's name, which is why the address is an
 *  edition's fact and not the app's. It is pointed at the same listing here on
 *  purpose: the extension is free, and it talks to whatever origin the user
 *  authorizes in it, so a self-hosted build works with it once you add your own
 *  address to its list. A fork that ships its own extension repoints this. */
export const CONNECT_STORE_URL =
  'https://chromewebstore.google.com/detail/localmd-connect-browser-s/bgennbocoapjiiolmmlcbfingimhmchh'
