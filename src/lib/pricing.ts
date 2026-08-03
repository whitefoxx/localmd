/**
 * The paid tier's public numbers, in one editable place.
 *
 * The pricing surface exists before the paid tier does, on purpose. What it
 * measures is willingness to pay, and there is exactly one moment when that can
 * be measured against real launch traffic — retrofitting a pricing page after
 * the launch spends the traffic that mattered and asks the question of whoever
 * happens to still be around.
 *
 * So the page states the price plainly, says it is not live, and offers a
 * limited number of early slots: a time-limited key in exchange for an email
 * and feedback. The scarcity is what keeps the offer a signal — a free thing
 * with no limit measures willingness to accept free things, which everyone has.
 * The number that actually decides anything is further down the funnel anyway
 * (did a slot holder USE a paid feature), and it needs the slots to exist first.
 */

/** One-time, includes a year of updates. */
export const PRICE_USD = 39

/** Early-slot cohort size. Small enough to stay scarce and to sign by hand,
 *  large enough that the claim→use rate means something. */
export const EARLY_SLOTS_TOTAL = 100

/**
 * How many have gone out. Bumped by hand at release time — deliberately a
 * constant rather than a counter somewhere: a live count needs a backend, and
 * this number changes a few times over a few weeks. Being a day stale costs
 * nothing; being a static page is the product.
 */
export const EARLY_SLOTS_TAKEN = 0

/** Days an early slot runs for. */
export const EARLY_SLOT_DAYS = 90

/**
 * Where an early-slot request goes. Either an https form URL (Tally, Formspree
 * — anything that lands in an inbox) or a bare email address.
 *
 * Empty until one exists, and empty is handled: the offer is hidden entirely
 * rather than rendering a button that goes nowhere. The price and the "not live
 * yet" line still show, so the page is never broken — only smaller.
 */
export const EARLY_ACCESS_CONTACT = ''

export function slotsLeft(): number {
  return Math.max(0, EARLY_SLOTS_TOTAL - EARLY_SLOTS_TAKEN)
}

export type ContactKind = 'form' | 'email'

/** What kind of contact is configured, or null when there is none. */
export function contactKind(contact = EARLY_ACCESS_CONTACT): ContactKind | null {
  const c = contact.trim()
  if (!c) return null
  if (/^https:\/\/\S+$/.test(c)) return 'form'
  // Deliberately strict: a malformed value should read as "not configured"
  // rather than becoming a link that silently goes nowhere.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return 'email'
  return null
}

/** Where the button points. `null` when nothing is configured — callers hide
 *  the offer rather than render a dead control. */
export function contactHref(contact = EARLY_ACCESS_CONTACT, subject = 'localmd early access'): string | null {
  const c = contact.trim()
  switch (contactKind(c)) {
    case 'form':
      return c
    case 'email':
      return `mailto:${c}?subject=${encodeURIComponent(subject)}`
    default:
      return null
  }
}

/** Whether the early-slot offer can be shown at all. */
export function earlyAccessOpen(contact = EARLY_ACCESS_CONTACT): boolean {
  return contactKind(contact) !== null && slotsLeft() > 0
}
