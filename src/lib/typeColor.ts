/**
 * Deterministic color for an OKF `type` label. The same type string always
 * maps to the same hue, so a concept's type reads as one color in both the
 * file-tree chip and the graph node — turning `type` into a visual cluster cue.
 */
export function typeColor(type: string): string {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 55% 55%)`
}
