/**
 * E2E bootstrap (?e2e=1): boots the app against an in-memory folder with the
 * mock LLM provider configured — no native pickers, no network, deterministic.
 * Only ever invoked from main.ts when the query flag is present.
 */
import { createMemoryRoot } from '@/lib/memfs'
import { useKbStore } from '@/stores/kb'
import { useSettingsStore } from '@/stores/settings'

export async function bootstrapE2e(): Promise<void> {
  const settings = useSettingsStore()
  settings.state.profiles = [
    { id: 'mock', label: 'Mock', provider: 'mock', baseUrl: '', apiKey: 'mock', model: 'mock-1' },
  ]
  settings.state.slots = { primary: 'mock' }
  settings.state.mcpServers = []
  settings.state.checkpointMode = 'off'
  settings.state.writeMode = 'auto'

  const kb = useKbStore()
  await kb.openHandle(createMemoryRoot('e2e-kb'))
}
