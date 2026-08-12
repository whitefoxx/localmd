/**
 * Outward-facing addresses, in one place.
 *
 * Not a config file — these are compiled constants. They live together because
 * each of them appears in several surfaces (the help panel, the landing page,
 * the manual, launch copy), and a link that is right in three places and stale
 * in the fourth is worse than one that is wrong everywhere: nobody notices.
 */

/** Public issue tracker. Deliberately a repository with no code in it — the app
 *  is not open source, but the reports about it are, so a visitor can see what
 *  is already known before writing anything. */
export const FEEDBACK_URL = 'https://github.com/whitefoxx/localmd-feedback'

/** For anything that should not be discussed in public: a security issue, or a
 *  document someone cannot paste into a public tracker. */
export const CONTACT_EMAIL = 'yunbiaoch@gmail.com'
