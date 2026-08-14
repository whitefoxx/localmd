/**
 * Reactive skill list for the UI (slash autocomplete, preset buttons).
 * Refreshed on KB switch and lazily when the slash dropdown opens.
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { listSkills, type SkillMeta } from '@/lib/skills'
import { useKbStore } from '@/stores/kb'

export const useSkillsStore = defineStore('skills', () => {
  const all = ref<SkillMeta[]>([])

  /** What the UI offers. A skill marked `invocation: model` is the agent's to
   *  choose, not a menu entry — filtered in one place so neither the slash
   *  menu nor the composer buttons can drift from the other. */
  const forUser = computed(() => all.value.filter((s) => s.userInvocable))

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

  return { all, forUser, refresh }
})
