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

/** One time, for good. Not a subscription and not a year of updates — the app
 *  is a static page a buyer already holds, so metering upgrades would cost more
 *  to build than it could collect. */
export const PRICE_USD = 20

/** Early-slot cohort size. Small enough to stay scarce and to sign by hand,
 *  large enough that the claim→use rate means something. */
export const EARLY_SLOTS_TOTAL = 100

/**
 * How many have gone out. Bumped by hand at release time — deliberately a
 * constant rather than a counter somewhere: a live count needs a backend, and
 * this number changes a few times over a few weeks. Being a day stale costs
 * nothing; being a static page is the product.
 */
export const EARLY_SLOTS_TAKEN = 1

/** Days an early slot runs for. */
export const EARLY_SLOT_DAYS = 90

/**
 * Where an early-slot request goes. Either an https form URL (Tally, Formspree
 * — anything that lands in an inbox) or a bare email address.
 *
 * A form rather than a mailto, on purpose. The point of the early slots is not
 * the slots: it is the first honest reading of whether anyone wants the paid
 * tier, and that reading is a rate — how many who opened the offer went on to
 * ask for one. A mailto produces no denominator and no numerator, only however
 * many messages happen to arrive.
 *
 * Empty is still handled: the offer hides entirely rather than rendering a
 * button that goes nowhere, leaving the price and the "not live yet" line.
 */
export const EARLY_ACCESS_CONTACT = 'https://tally.so/r/obN72P'

export function slotsLeft(taken = EARLY_SLOTS_TAKEN): number {
  return Math.max(0, EARLY_SLOTS_TOTAL - taken)
}

/**
 * The live taken-count from `/api/slots` (a same-origin proxy over the gist
 * the signing script maintains), or null when it cannot be had.
 *
 * Null is a first-class answer, not an error: dev servers have no /api, the
 * sidecar may be down, a visitor may be offline. The compiled constant is the
 * deliberately-maintained fallback, so a failed fetch shows a slightly stale
 * number rather than a broken dialog — and the caller treats null exactly as
 * "use the constant".
 *
 * Clamped to [constant, total]: the ledger only ever grows, so a live value
 * BELOW the shipped constant can only be a misconfigured counter — showing
 * more slots than the last deploy knew of would oversell scarcity in reverse.
 */
export async function liveSlotsTaken(): Promise<number | null> {
  try {
    const res = await fetch('/api/slots', { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const n = Number.parseInt((await res.text()).trim(), 10)
    if (!Number.isInteger(n)) return null
    return Math.min(EARLY_SLOTS_TOTAL, Math.max(EARLY_SLOTS_TAKEN, n))
  } catch {
    return null
  }
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
