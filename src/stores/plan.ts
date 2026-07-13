/**
 * The agent's living task list (Claude Code TodoWrite semantics): the
 * update_plan tool replaces the whole list each call; the chat panel renders
 * it as a checklist card. Keyed by chat session so concurrent sessions keep
 * independent plans; entries are dropped when their tab closes or the KB
 * switches.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type PlanStatus = 'pending' | 'in_progress' | 'done'

export interface PlanItem {
  text: string
  status: PlanStatus
}

export const usePlanStore = defineStore('plan', () => {
  const byId = ref(new Map<string, PlanItem[]>())

  function itemsFor(sessionId: string | null): PlanItem[] {
    return sessionId ? (byId.value.get(sessionId) ?? []) : []
  }

  function set(sessionId: string, next: PlanItem[]): void {
    byId.value.set(sessionId, next)
  }

  function clear(sessionId: string): void {
    byId.value.delete(sessionId)
  }

  function reset(): void {
    byId.value.clear()
  }

  return { byId, itemsFor, set, clear, reset }
})
