/**
 * Whether this build restricts the connections — it does not.
 *
 * This edition has no paid tier, so every gate is open and there is no licence,
 * no crypto and no pricing surface behind these answers. Callers are
 * byte-identical to the hosted build's; only this file differs. See CONTEXT.md,
 * "Edition".
 */

export interface Gate {
  readonly restricted: boolean
}

/**
 * A property, not a ref, and the distinction is load-bearing rather than
 * stylistic: a template unwraps a ref and plain script does not, so an exported
 * `ComputedRef` reads as two different things in the two places that read this
 * — and TypeScript cannot tell them apart inside a truthiness test. That once
 * made every installed tool row claim it needed a licence. `gate.test.ts` pins
 * the contract; keep the answer a primitive.
 */
export const gate: Gate = { restricted: false }

export function toolRestricted(_name: string): boolean {
  return false
}

/** Unreachable while `restricted` is false, and typed anyway so the call site
 *  that would use it needs no branch. */
export function restrictedToolResult(toolName: string): string {
  return `Error: ${toolName} is unavailable in this build. Do not retry.`
}
