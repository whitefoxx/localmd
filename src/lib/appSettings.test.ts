import { describe, it, expect } from 'vitest'
import { WRITABLE, WRITABLE_BY_KEY, describeWritable } from './appSettings'
import { normalizeSettings } from '@/stores/settings'

function fresh() {
  return normalizeSettings({})
}

describe('agent-writable settings', () => {
  /**
   * The point of the allowlist. If someone adds a credential field and wires it
   * in here by habit, this fails rather than shipping a way for the agent to
   * read the user's API key.
   */
  it('exposes nothing that could carry a credential', () => {
    const forbidden = /key|token|secret|password|credential|auth/i
    const leaks = WRITABLE.filter((f) => forbidden.test(f.key))
    expect(leaks.map((f) => f.key)).toEqual([])
  })

  /**
   * The name regex above is a spelling check; these two are the behaviour. The
   * shortest path past the paid gate is an agent that can read or write its own
   * licence, and a field called something innocent would sail through a name
   * test. So: no field returns the value, and no field can be made to set it.
   */
  it('never reveals the licence key, whatever a field is called', () => {
    const s = fresh()
    s.licenceKey = 'LMD1.sentinel.value'
    for (const f of WRITABLE) {
      expect(String(f.read(s)), `${f.key} leaks the licence`).not.toContain('sentinel')
    }
    expect(describeWritable()).not.toContain('sentinel')
  })

  it('cannot be talked into setting a licence key', () => {
    for (const f of WRITABLE) {
      const s = fresh()
      f.write(s, 'LMD1.forged.key')
      expect(s.licenceKey, `${f.key} wrote the licence`).toBe('')
    }
  })

  it('reads a value for every field it advertises', () => {
    const s = fresh()
    for (const f of WRITABLE) {
      expect(f.read(s), `${f.key} read`).toBeDefined()
    }
    const doc = describeWritable()
    for (const f of WRITABLE) expect(doc).toContain(f.key)
  })

  it('applies a valid change', () => {
    const s = fresh()
    expect(WRITABLE_BY_KEY.get('write_mode')!.write(s, 'ask')).toBeNull()
    expect(s.writeMode).toBe('ask')

    expect(WRITABLE_BY_KEY.get('agent_multi_tab')!.write(s, 'true')).toBeNull()
    expect(s.agentMultiTab).toBe(true)

    expect(WRITABLE_BY_KEY.get('agent_max_tabs')!.write(s, '5')).toBeNull()
    expect(s.agentMaxTabs).toBe(5)
  })

  it('rejects a value outside the allowed set, leaving the setting alone', () => {
    const s = fresh()
    const before = s.writeMode
    const err = WRITABLE_BY_KEY.get('write_mode')!.write(s, 'yes')
    expect(err).toMatch(/auto \| ask/)
    expect(s.writeMode).toBe(before)
  })

  it('rejects out-of-range numbers', () => {
    const s = fresh()
    expect(WRITABLE_BY_KEY.get('agent_max_tabs')!.write(s, '99')).toMatch(/2–8/)
    expect(WRITABLE_BY_KEY.get('agent_max_tabs')!.write(s, 'lots')).toMatch(/2–8/)
    expect(WRITABLE_BY_KEY.get('tts_rate')!.write(s, '9')).toMatch(/0.5–2/)
  })

  it('keeps tts_rate fractional — it is the one field that is not an integer', () => {
    const s = fresh()
    expect(WRITABLE_BY_KEY.get('tts_rate')!.write(s, '1.25')).toBeNull()
    expect(s.ttsRate).toBe(1.25)
  })
})
