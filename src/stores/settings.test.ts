import { describe, it, expect } from 'vitest'
import { normalizeSettings, autoLabel } from './settings'

describe('normalizeSettings — legacy single-provider migration', () => {
  it('migrates a configured anthropic setup', () => {
    const s = normalizeSettings({
      provider: 'anthropic',
      anthropicApiKey: 'sk-ant-x',
      anthropicModel: 'claude-opus-4-8',
      openaiApiKey: '',
      openaiModel: '',
      openaiBaseUrl: 'https://api.openai.com/v1',
    })
    expect(s.profiles).toHaveLength(1)
    expect(s.profiles[0].provider).toBe('anthropic')
    expect(s.profiles[0].apiKey).toBe('sk-ant-x')
    expect(s.slots.primary).toBe(s.profiles[0].id)
  })

  it('migrates both providers and keeps the active one primary', () => {
    const s = normalizeSettings({
      provider: 'openai',
      anthropicApiKey: 'sk-ant-x',
      anthropicModel: 'claude-opus-4-8',
      openaiApiKey: 'sk-ds',
      openaiModel: 'deepseek-chat',
      openaiBaseUrl: 'https://api.deepseek.com',
    })
    expect(s.profiles).toHaveLength(2)
    const primary = s.profiles.find((p) => p.id === s.slots.primary)!
    expect(primary.provider).toBe('deepseek') // recognized from the preset baseUrl
    expect(primary.model).toBe('deepseek-chat')
  })

  it('returns an empty store for unconfigured legacy settings', () => {
    const s = normalizeSettings({ provider: 'anthropic', anthropicApiKey: '' })
    expect(s.profiles).toHaveLength(0)
    expect(s.slots.primary).toBeUndefined()
  })
})

describe('normalizeSettings — multi-profile shape', () => {
  it('passes through and clamps dangling slot ids', () => {
    const s = normalizeSettings({
      profiles: [
        { id: 'a', label: 'A', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-chat' },
      ],
      slots: { primary: 'a', vision: 'gone' },
    })
    expect(s.slots.primary).toBe('a')
    expect(s.slots.vision).toBeUndefined()
  })

  it('defaults a missing primary to the first profile', () => {
    const s = normalizeSettings({
      profiles: [
        { id: 'a', provider: 'openai', baseUrl: 'x', apiKey: 'k', model: 'm' },
        { id: 'b', provider: 'openai', baseUrl: 'x', apiKey: 'k', model: 'm' },
      ],
      slots: {},
    })
    expect(s.slots.primary).toBe('a')
  })

  it('drops invalid maxTokens and keeps valid ones', () => {
    const s = normalizeSettings({
      profiles: [
        { id: 'a', provider: 'openai', baseUrl: 'x', apiKey: 'k', model: 'm', maxTokens: 4096 },
        { id: 'b', provider: 'openai', baseUrl: 'x', apiKey: 'k', model: 'm', maxTokens: 'lots' },
      ],
      slots: { primary: 'a' },
    })
    expect(s.profiles[0].maxTokens).toBe(4096)
    expect(s.profiles[1].maxTokens).toBeUndefined()
  })

  it('rejects garbage', () => {
    const empty = {
      profiles: [],
      slots: {},
      gitName: '',
      gitEmail: '',
      githubToken: '',
      writeMode: 'auto',
      checkpointMode: 'off',
      mcpServers: [],
    }
    expect(normalizeSettings(null)).toEqual(empty)
    expect(normalizeSettings('x')).toEqual(empty)
    expect(normalizeSettings({})).toEqual(empty)
  })

  it('keeps git/github fields through normalization', () => {
    const s = normalizeSettings({
      profiles: [],
      slots: {},
      gitName: 'cyb',
      gitEmail: 'a@b.c',
      githubToken: 'ghp_x',
    })
    expect(s.gitName).toBe('cyb')
    expect(s.gitEmail).toBe('a@b.c')
    expect(s.githubToken).toBe('ghp_x')
  })
})

describe('autoLabel', () => {
  it('uses preset labels', () => {
    expect(autoLabel({ provider: 'anthropic', model: 'claude-opus-4-8' })).toBe(
      'Anthropic · claude-opus-4-8',
    )
    expect(autoLabel({ provider: 'deepseek', model: 'deepseek-chat' })).toBe(
      'DeepSeek · deepseek-chat',
    )
  })
  it('falls back to the raw provider id', () => {
    expect(autoLabel({ provider: 'myproxy', model: '' })).toBe('myproxy')
  })
})
