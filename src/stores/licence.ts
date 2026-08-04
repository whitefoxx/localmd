/**
 * Whether this browser holds a valid licence, and what to say when it does not.
 *
 * Verification is asynchronous (WebCrypto) but every gate that asks is
 * synchronous — a computed in a template, a branch in the tool loop. So the
 * verdict is held here, recomputed when the key changes and once at startup,
 * and read everywhere as plain state.
 *
 * `unlocked` is the only question a gate should ask. The verdict itself is for
 * the settings row, which has four different things to say: valid, expired
 * (with the returning offer), not signed by us, and could-not-check. Collapsing
 * those into a boolean at the source would leave the UI unable to tell a former
 * customer apart from someone pasting nonsense.
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { isE2eMode } from '@/lib/e2e'
import { useSettingsStore } from '@/stores/settings'
import {
  verifyLicenceKey,
  unlocks,
  daysLeft,
  ENFORCE_LICENCE,
  type LicenceVerdict,
} from '@/lib/licence'

export const useLicenceStore = defineStore('licence', () => {
  const settings = useSettingsStore()

  const verdict = ref<LicenceVerdict | null>(null)
  const checking = ref(false)

  /** The key as stored. Writing it re-verifies; the verdict never lags it. */
  const key = computed<string>({
    get: () => settings.state.licenceKey,
    set: (v) => {
      settings.state.licenceKey = v.trim()
    },
  })

  async function check(): Promise<void> {
    // E2E runs in a mock world with no private key to mint real signatures, so
    // the crypto path would leave every run unlicensed and re-test the gate in
    // every flow. Instead the licence is part of the mock, like the LLM: valid
    // by default so the mechanics stay testable, `e2e-unlicensed` to pin the
    // locked state when a test is ABOUT the gate.
    if (isE2eMode()) {
      verdict.value = new URLSearchParams(location.search).has('e2e-unlicensed')
        ? null
        : {
            status: 'valid',
            licence: { id: 'e2e', kind: 'pro', issued: '2026-01-01', expires: null },
          }
      return
    }
    const k = settings.state.licenceKey
    if (!k) {
      verdict.value = null
      return
    }
    checking.value = true
    try {
      verdict.value = await verifyLicenceKey(k)
    } finally {
      checking.value = false
    }
  }

  // The stored key is the input; re-verify whenever it changes, including the
  // initial hydration from localStorage.
  watch(() => settings.state.licenceKey, check, { immediate: true })

  /** Does this browser hold a valid licence? What the settings row reflects. */
  const active = computed(() => unlocks(verdict.value))

  /** The one question a gate asks: must this licensed feature refuse?
   *
   *  Not simply `!active`. Until the paid tier launches, enforcement is off and
   *  nothing refuses — see ENFORCE_LICENCE. Keeping the two apart means the
   *  settings row can tell the truth about a key ("no licence") while the gates
   *  stay open, instead of the app having to lie in one place or break in the
   *  other. */
  const restricted = computed(() => ENFORCE_LICENCE && !active.value)

  /** Days left on a time-limited licence — the settings row counts down, and it
   *  is what makes an early slot feel like a slot rather than a gift. */
  const remainingDays = computed<number | null>(() => {
    const v = verdict.value
    if (v?.status !== 'valid') return null
    return daysLeft(v.licence)
  })

  function clear(): void {
    key.value = ''
  }

  return { key, verdict, checking, active, restricted, remainingDays, check, clear }
})
