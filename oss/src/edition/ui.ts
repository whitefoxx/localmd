/**
 * Nothing to sell, so none of these screens exist.
 *
 * Every consumer reads `<component :is="X" v-if="X" />`, so an absent screen
 * costs the page nothing — no hidden markup, no imports, no strings about a
 * price this build does not have.
 */
import type { Component } from 'vue'

/**
 * Whether this edition sells anything. It does not.
 *
 * Not the same question as `gate.restricted`, which asks whether a licence is
 * missing right now — this asks whether the words "paid", "licence" and "free"
 * mean anything here at all. They do not, so the copy that uses them is not
 * merely irrelevant, it is false: the Tools page once labelled connections
 * "Paid" and said one licence covered them, while letting anyone tick every
 * box, because nothing here gates them.
 */
export const HAS_PAID_TIER = false

export const PRICING_DIALOG: Component | null = null
export const PRICING_BLOCK: Component | null = null
export const LICENCE_SECTION: Component | null = null
