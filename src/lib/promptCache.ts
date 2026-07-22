/**
 * Anthropic prompt-cache breakpoints over the message history.
 *
 * Anthropic caching is explicit: only content before a `cache_control` marker
 * can be cached, and each agent step re-sends the whole conversation. Without
 * a marker on the messages, every step of every turn re-reads the full history
 * at full price. The fix is the canonical "moving breakpoint": before each
 * request, mark the LAST message — the previous request's prefix (cached up to
 * its own marker) is a prefix of this one, so Anthropic hits it and caches the
 * delta incrementally (writes cost 1.25×, subsequent reads 0.1×).
 *
 * The marker must MOVE, not accumulate — Anthropic allows at most 4
 * breakpoints per request (two are spent on the system blocks), so earlier
 * marks are stripped. Operates on copies; callers pass in-flight message
 * arrays and persisted history never carries markers.
 */
import type { ModelMessage } from 'ai'

type ProviderOptions = Record<string, Record<string, unknown>>

const BREAKPOINT = { cacheControl: { type: 'ephemeral' } }

/** Remove an anthropic cacheControl marker, dropping now-empty containers. */
function strip(m: ModelMessage): ModelMessage {
  const po = (m as { providerOptions?: ProviderOptions }).providerOptions
  if (!po?.anthropic?.cacheControl) return m
  const { cacheControl: _, ...anthropic } = po.anthropic
  const { anthropic: __, ...rest } = po
  const providerOptions = (
    Object.keys(anthropic).length ? { ...rest, anthropic } : rest
  ) as ModelMessage['providerOptions']
  const out = { ...m } as ModelMessage & { providerOptions?: unknown }
  if (providerOptions && Object.keys(providerOptions).length) out.providerOptions = providerOptions
  else delete out.providerOptions
  return out as ModelMessage
}

function mark(m: ModelMessage): ModelMessage {
  const po = (m as { providerOptions?: ProviderOptions }).providerOptions
  return {
    ...m,
    providerOptions: { ...po, anthropic: { ...po?.anthropic, ...BREAKPOINT } },
  } as ModelMessage
}

/** Copy of `messages` with the cache breakpoint on the last message only. */
export function withMovingBreakpoint(messages: ModelMessage[]): ModelMessage[] {
  if (!messages.length) return messages
  const last = messages.length - 1
  return messages.map((m, i) => (i === last ? mark(strip(m)) : strip(m)))
}
