/**
 * The freeze decision behind sessionSystemPrompt: a session's system prompt is
 * rebuilt only when a fingerprinted (non-file) input changes. The property that
 * matters for the prompt cache: while nothing fingerprinted changes, the SAME
 * object comes back — zero file reads, zero byte drift — so mid-session writes
 * to MEMORY.md / skills / AGENTS.md cannot move the prompt bytes and invalidate
 * the cached history behind them. The rebuild path is buildSystemPrompt itself,
 * which needs a real KB and is exercised in the browser.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { systemPromptFingerprint, sessionSystemPrompt } from './prompt'
import { useGitStore } from '@/stores/git'

globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
} as unknown as Storage

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('systemPromptFingerprint', () => {
  it('is stable while the stores are', () => {
    expect(systemPromptFingerprint()).toBe(systemPromptFingerprint())
  })

  it('changes when a fingerprinted input changes (repo state)', () => {
    const before = systemPromptFingerprint()
    useGitStore().isRepo = true
    expect(systemPromptFingerprint()).not.toBe(before)
  })
})

describe('sessionSystemPrompt', () => {
  it('returns the cached prompt object untouched while the fingerprint holds', async () => {
    const cache = {
      fingerprint: systemPromptFingerprint(),
      parts: { stable: 'S', dynamic: 'D' },
    }
    expect(await sessionSystemPrompt(cache)).toBe(cache)
  })
})
