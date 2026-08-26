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

/**
 * Whether this edition sells anything.
 *
 * Not the same question as `gate.restricted`, which asks whether a licence is
 * missing right now — a licensed hosted browser answers `false` to that and
 * still wants the Tools page to say which half of it is paid for. This asks
 * whether the words "paid", "licence" and "free" mean anything here at all.
 * Where they do not, copy asserting them is simply false, and the Tools page
 * once told open-source users that connections were paid while cheerfully
 * letting them tick every box.
 */
export const HAS_PAID_TIER = true
import PricingBlock from '@/components/PricingBlock.vue'
import LicenceSection from '@/components/settings/LicenceSection.vue'

/** The price + early-slot modal, mounted at the app root. */
export const PRICING_DIALOG: Component | null = PricingDialog

/** The landing page's pricing section. */
export const PRICING_BLOCK: Component | null = PricingBlock

/** Settings → Licence. Null also removes the nav entry that leads to it. */
export const LICENCE_SECTION: Component | null = LicenceSection
