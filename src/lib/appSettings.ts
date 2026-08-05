/**
 * The slice of app configuration the agent may read and change.
 *
 * An allowlist, not a filter over the settings object. The difference matters:
 * a filter has to remember to exclude each new secret, and the day someone adds
 * one and forgets, it leaks. Here a field the agent can touch has to be written
 * down on purpose, so the default for anything new — including every future
 * key, token and credential — is invisible.
 *
 * Never listed, and never will be: `profiles[].apiKey`, `githubToken`,
 * `toolSecrets` values, `mcpServers[].token`, `mcpServers[].headers` (a server
 * row carries its key in whatever header the service chose, so the header value
 * is a credential like any other), and `mcpAuth` (OAuth access and refresh
 * tokens — the agent asks the user to sign in, and only ever learns that a row
 * now connects). The agent collects those through
 * request_setup, where the user types the value straight into the app and the
 * conversation only learns that a value now exists.
 *
 * Reads are shaped rather than raw: what comes back is what a person would say
 * about their setup ("primary is Claude, write mode is auto, 4 tool sets
 * installed"), not a JSON dump the model then has to interpret.
 */
import type { SettingsState } from '@/stores/settings'

/** A writable field: how to read it, how to validate a proposed value, and how
 *  to apply it. `describe` is what the agent is told the field means. */
export interface WritableField {
  key: string
  describe: string
  /** Allowed values, when it is a fixed set — used for validation and shown to
   *  the agent so it does not have to guess the vocabulary. */
  values?: readonly string[]
  read: (s: SettingsState) => string | number | boolean
  /** Returns an error string, or null and applies the change. */
  write: (s: SettingsState, raw: string) => string | null
}

function bool(
  key: string,
  describe: string,
  get: (s: SettingsState) => boolean,
  set: (s: SettingsState, v: boolean) => void,
): WritableField {
  return {
    key,
    describe,
    values: ['true', 'false'],
    read: get,
    write: (s, raw) => {
      if (raw !== 'true' && raw !== 'false') return `${key} takes "true" or "false", got "${raw}"`
      set(s, raw === 'true')
      return null
    },
  }
}

function choice(
  key: string,
  describe: string,
  values: readonly string[],
  get: (s: SettingsState) => string,
  set: (s: SettingsState, v: string) => void,
): WritableField {
  return {
    key,
    describe,
    values,
    read: get,
    write: (s, raw) => {
      if (!values.includes(raw)) return `${key} takes one of ${values.join(' | ')}, got "${raw}"`
      set(s, raw)
      return null
    },
  }
}

function int(
  key: string,
  describe: string,
  min: number,
  max: number,
  get: (s: SettingsState) => number,
  set: (s: SettingsState, v: number) => void,
): WritableField {
  return {
    key,
    describe,
    read: get,
    write: (s, raw) => {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < min || n > max) return `${key} takes a number ${min}–${max}, got "${raw}"`
      set(s, Math.round(n))
      return null
    },
  }
}

export const WRITABLE: WritableField[] = [
  choice(
    'write_mode',
    'auto = the agent\'s writes land immediately and are reviewable afterwards; ask = every write pauses for the user to approve',
    ['auto', 'ask'],
    (s) => s.writeMode,
    (s, v) => {
      s.writeMode = v as SettingsState['writeMode']
    },
  ),
  bool(
    'agent_multi_tab',
    'whether the agent panel may hold several chat sessions at once',
    (s) => s.agentMultiTab,
    (s, v) => {
      s.agentMultiTab = v
    },
  ),
  int(
    'agent_max_tabs',
    'how many chat sessions at once when multi-tab is on',
    2,
    8,
    (s) => s.agentMaxTabs,
    (s, v) => {
      s.agentMaxTabs = v
    },
  ),
  bool(
    'rich_editor',
    'live rendering in the markdown editor: syntax hides on lines the cursor is not on, and images, formulas and task boxes draw in place',
    (s) => s.richEditor,
    (s, v) => {
      s.richEditor = v
    },
  ),
  choice(
    'theme',
    'colour scheme of the app; system follows the operating system',
    ['system', 'light', 'dark'],
    (s) => s.theme,
    (s, v) => {
      s.theme = v as SettingsState['theme']
    },
  ),
  int(
    'tts_rate',
    'read-aloud speed, 0.5 (slow) to 2 (fast)',
    0.5,
    2,
    (s) => s.ttsRate,
    (s, v) => {
      s.ttsRate = v
    },
  ),
  {
    key: 'git_name',
    describe: 'commit author name for commits made in the app (the repo\'s own git config wins when it has one)',
    read: (s) => s.gitName,
    write: (s, raw) => {
      s.gitName = raw.trim()
      return null
    },
  },
  {
    key: 'git_email',
    describe: 'commit author email',
    read: (s) => s.gitEmail,
    write: (s, raw) => {
      s.gitEmail = raw.trim()
      return null
    },
  },
]

// tts_rate is a float, so the int() helper's rounding is wrong for it.
const ttsRate = WRITABLE.find((f) => f.key === 'tts_rate')!
ttsRate.write = (s, raw) => {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0.5 || n > 2) return `tts_rate takes a number 0.5–2, got "${raw}"`
  s.ttsRate = n
  return null
}

export const WRITABLE_BY_KEY = new Map(WRITABLE.map((f) => [f.key, f]))

/** The field reference handed to the agent when it asks what it can change —
 *  delivered by the tool's `get` result rather than its description, so the
 *  bytes are paid only by a turn that actually configures something. */
export function describeWritable(): string {
  return WRITABLE.map(
    (f) => `- ${f.key}${f.values ? ` (${f.values.join(' | ')})` : ''}: ${f.describe}`,
  ).join('\n')
}
