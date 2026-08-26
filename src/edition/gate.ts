/**
 * Whether this build restricts the connections, and what to say when it does.
 *
 * This is the seam. Core code — the tool loop, the two tool stores, the panels
 * — asks the three questions below and never mentions a licence, so an edition
 * that has no paid tier answers them in a dozen lines with no crypto, no store
 * and no pricing surface, while every caller stays byte-identical between the
 * two builds.
 *
 * The vocabulary is CONTEXT.md's: **restricted** is the question a gate asks
 * (`ENFORCE_LICENCE && !active`), and it stays that word here. What changes is
 * only who answers it — a licence in the hosted build, nobody in the other.
 *
 * `restricted` is a ComputedRef because its readers are split down the middle:
 * templates want reactivity, the tool loop wants a synchronous boolean. One
 * source, read as `.value` in TypeScript and unwrapped in a template.
 */
import { computed, type ComputedRef } from 'vue'
import { useLicenceStore } from '@/stores/licence'
import { needsLicence, lockedToolResult } from '@/lib/licence'

/** Must a connection refuse? Reactive, so a key pasted or lapsing mid-session
 *  reaches the rows and buttons that were drawn before it. */
export const restricted: ComputedRef<boolean> = computed(() => useLicenceStore().restricted)

/**
 * Whether this built-in tool call must be refused.
 *
 * Asked at call time, not at registration time: the tool list is part of the
 * provider's cache prefix, so a key pasted or expiring mid-session must not
 * change which tools were serialized. Only the answer changes.
 *
 * Tolerates the store being unavailable (tests, and any non-app caller) by
 * treating that as unlocked — a missing Pinia instance is our problem, and the
 * failure mode that matters is charging someone twice, not gating too little.
 * The stores below read `restricted` directly and need no such tolerance: they
 * are Pinia themselves, so by the time they ask, Pinia is there.
 */
export function toolRestricted(name: string): boolean {
  if (!needsLicence(name)) return false
  try {
    return useLicenceStore().restricted
  } catch {
    return false
  }
}

/** What a refused call hands back to the model. */
export const restrictedToolResult: (toolName: string) => string = lockedToolResult
