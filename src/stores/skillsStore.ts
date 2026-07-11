/**
 * Reactive skill list for the UI (slash autocomplete, preset buttons).
 * Refreshed on KB switch and lazily when the slash dropdown opens.
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { listSkills, type SkillMeta } from '@/lib/skills'
import { useKbStore } from '@/stores/kb'

export const useSkillsStore = defineStore('skills', () => {
  const all = ref<SkillMeta[]>([])

  async function refresh(): Promise<void> {
    const kb = useKbStore()
    all.value = kb.name ? await listSkills() : []
  }

  const kb = useKbStore()
  watch(
    () => kb.name,
    () => void refresh(),
    { immediate: true },
  )

  return { all, refresh }
})
