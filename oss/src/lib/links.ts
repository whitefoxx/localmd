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
