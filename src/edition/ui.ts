/**
 * Screens that only exist where there is something to sell.
 *
 * Components rather than booleans, so an edition without a paid tier drops the
 * markup and its imports instead of shipping panels it renders `v-if="false"`.
 * Every consumer is `<component :is="X" v-if="X" />`, which reads the same in
 * both builds.
 */
import type { Component } from 'vue'
import PricingDialog from '@/components/PricingDialog.vue'

/** The price + early-slot modal, mounted at the app root. */
export const PRICING_DIALOG: Component | null = PricingDialog
