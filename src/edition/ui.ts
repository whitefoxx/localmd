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
import PricingBlock from '@/components/PricingBlock.vue'
import LicenceSection from '@/components/settings/LicenceSection.vue'

/** The price + early-slot modal, mounted at the app root. */
export const PRICING_DIALOG: Component | null = PricingDialog

/** The landing page's pricing section. */
export const PRICING_BLOCK: Component | null = PricingBlock

/** Settings → Licence. Null also removes the nav entry that leads to it. */
export const LICENCE_SECTION: Component | null = LicenceSection
