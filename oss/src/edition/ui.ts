/**
 * Nothing to sell, so none of these screens exist.
 *
 * Every consumer reads `<component :is="X" v-if="X" />`, so an absent screen
 * costs the page nothing — no hidden markup, no imports, no strings about a
 * price this build does not have.
 */
import type { Component } from 'vue'

export const PRICING_DIALOG: Component | null = null
export const PRICING_BLOCK: Component | null = null
export const LICENCE_SECTION: Component | null = null
