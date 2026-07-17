/** Clipboard helpers for code blocks and the tool-call inspector. */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Briefly swap a copy button's icon to a check/error to confirm the action. */
export function flashCopy(btn: HTMLElement, ok: boolean): void {
  const icon = btn.querySelector('.codicon')
  if (!icon) return
  icon.classList.remove('codicon-copy')
  icon.classList.add(ok ? 'codicon-check' : 'codicon-error')
  btn.classList.add('code-copied')
  window.setTimeout(() => {
    icon.classList.remove('codicon-check', 'codicon-error')
    icon.classList.add('codicon-copy')
    btn.classList.remove('code-copied')
  }, 1200)
}

/** Delegated handler for copy buttons inside markdown-rendered code blocks
 *  (which live in a v-html string). Returns true when it handled the click. */
export function handleCodeCopy(e: MouseEvent): boolean {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('.code-copy')
  if (!btn) return false
  e.preventDefault()
  const text = btn.parentElement?.querySelector('pre')?.textContent ?? ''
  void copyText(text).then((ok) => flashCopy(btn, ok))
  return true
}
