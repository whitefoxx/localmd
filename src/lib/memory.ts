/**
 * KB memory — a single, fixed-name markdown file in the knowledge-base root
 * (MEMORY.md) holding durable, cross-session context the agent should always
 * honor: the user's stable preferences, ongoing project state, and decisions
 * worth carrying between sessions.
 *
 * Unlike skills (progressive disclosure across many SKILL.md files), memory is
 * one plain file injected in full into the system prompt when present — so the
 * agent honors it without a tool round-trip. It is an ordinary KB file: the
 * user edits it directly like any page, or asks the agent to create/update it
 * with the normal write_file / edit_file tools. The agent never writes to it
 * unprompted — in particular it does NOT auto-summarize conversations into it.
 */
import * as fs from '@/lib/fs'

/** Fixed KB-relative path of the memory file. */
export const MEMORY_FILE = 'MEMORY.md'

/** Trim raw file content to non-empty memory, or null when blank/absent. */
export function normalizeMemory(md: string | null): string | null {
  const trimmed = md?.trim()
  return trimmed ? trimmed : null
}

/** Current memory content (trimmed), or null when the file is absent/empty. */
export async function readMemory(): Promise<string | null> {
  return normalizeMemory(await fs.tryReadFile(MEMORY_FILE))
}

/** Whether a non-empty memory file exists. */
export async function hasMemory(): Promise<boolean> {
  return (await readMemory()) !== null
}
