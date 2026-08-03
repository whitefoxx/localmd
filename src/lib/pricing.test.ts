import { describe, it, expect } from 'vitest'
import {
  contactKind,
  contactHref,
  earlyAccessOpen,
  slotsLeft,
  EARLY_SLOTS_TOTAL,
  EARLY_SLOTS_TAKEN,
} from './pricing'

describe('early-access contact', () => {
  it('takes an https form URL', () => {
    expect(contactKind('https://tally.so/r/abc')).toBe('form')
    expect(contactHref('https://tally.so/r/abc')).toBe('https://tally.so/r/abc')
  })

  it('takes a bare email and builds a mailto with a subject', () => {
    expect(contactKind('hi@localmd.app')).toBe('email')
    expect(contactHref('hi@localmd.app', 'early access')).toBe(
      'mailto:hi@localmd.app?subject=early%20access',
    )
  })

  it('treats anything malformed as not configured, never as a link', () => {
    // A dead button is worse than no button: the visitor clicks, nothing
    // happens, and the offer reads as broken rather than absent.
    for (const bad of ['', '   ', 'localmd.app', 'http://tally.so/r/abc', 'not an email', '@x.com']) {
      expect(contactKind(bad)).toBeNull()
      expect(contactHref(bad)).toBeNull()
      expect(earlyAccessOpen(bad)).toBe(false)
    }
  })

  it('opens only when a contact exists AND slots remain', () => {
    expect(earlyAccessOpen('hi@localmd.app')).toBe(slotsLeft() > 0)
  })
})

describe('slot counting', () => {
  it('never goes negative', () => {
    expect(slotsLeft()).toBeGreaterThanOrEqual(0)
    expect(slotsLeft()).toBe(EARLY_SLOTS_TOTAL - EARLY_SLOTS_TAKEN)
  })

  it('ships with slots left to give — a page offering 0 of 100 is worse than no offer', () => {
    expect(EARLY_SLOTS_TAKEN).toBeLessThan(EARLY_SLOTS_TOTAL)
  })
})
