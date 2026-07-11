/**
 * The agent's living task list (Claude Code TodoWrite semantics): the
 * update_plan tool replaces the whole list each call; the chat panel renders
 * it as a checklist card. Cleared when the session or KB changes.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type PlanStatus = 'pending' | 'in_progress' | 'done'

export interface PlanItem {
  text: string
  status: PlanStatus
}

export const usePlanStore = defineStore('plan', () => {
  const items = ref<PlanItem[]>([])

  function set(next: PlanItem[]): void {
    items.value = next
  }

  function clear(): void {
    items.value = []
  }

  return { items, set, clear }
})
