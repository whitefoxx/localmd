/**
 * Outward-facing addresses, in one place.
 *
 * Not a config file — these are compiled constants. They live together because
 * each of them appears in several surfaces (the help panel, the landing page,
 * the manual), and a link that is right in three places and stale in the fourth
 * is worse than one that is wrong everywhere: nobody notices.
 *
 * Where reports go is an edition's own fact, not the software's: this build
 * sends them to the hosted service's tracker, and another sends them wherever
 * its own code lives. The open-source edition replaces this file.
 */

/** Public issue tracker for the hosted service. A repository with no code in
 *  it, so a visitor can see what is already known before writing anything. */
export const FEEDBACK_URL = 'https://github.com/whitefoxx/localmd.app-feedback'

/** Where the code is. The same address in both editions today — a fork that
 *  deploys its own build should point this at itself, which is the whole reason
 *  this file is the edition's and not the app's. */
export const SOURCE_URL = 'https://github.com/whitefoxx/localmd'
