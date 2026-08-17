/**
 * Scroll reveal for the landing page.
 *
 * `v-reveal` fades an element up the first time it enters the viewport, and an
 * optional value staggers it against its siblings: `v-reveal="2"`.
 *
 * The animation is driven by the Web Animations API rather than a class that
 * flips a CSS transition. The class approach reads better in a stylesheet, but
 * it leaves the resting state of real content at `opacity: 0` and depends on
 * the cascade to undo it — and anything that goes wrong there (a rule that does
 * not match, a transition that never starts) leaves the page permanently blank
 * rather than merely unanimated. Here the hidden state exists only for the
 * duration of an animation that owns it, and `finished` clears it.
 *
 * Every failure path ends with the element visible: reduced motion, no
 * IntersectionObserver, no `animate()`. A decoration wrapped around content may
 * not be the reason the content cannot be read.
 */
import type { Directive } from 'vue'

/** Milliseconds each stagger step adds — enough to read as a sequence, not
 *  enough to make anyone wait on the last item in a row. */
const STEP_MS = 70
const DURATION_MS = 700

let observer: IntersectionObserver | undefined

function reveal(el: HTMLElement): void {
  const delay = Number(el.dataset.revealStep ?? 0) * STEP_MS
  const show = (): void => {
    el.style.opacity = ''
  }
  const anim = el.animate(
    [
      { opacity: 0, transform: 'translateY(18px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: DURATION_MS, delay, easing: 'cubic-bezier(0.22, 0.68, 0.24, 1)', fill: 'backwards' },
  )
  // `fill: 'backwards'` holds the from-state through the delay, so the inline
  // opacity can go the moment the animation takes over. The timer is the
  // backstop for a browser that never settles `finished` — after it, the
  // element is visible no matter what happened to the animation.
  void anim.finished.then(show, show)
  setTimeout(show, delay + DURATION_MS + 500)
}

function ensureObserver(): IntersectionObserver | undefined {
  if (typeof IntersectionObserver === 'undefined') return undefined
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        reveal(entry.target as HTMLElement)
      }
    },
    // A little way in from the bottom edge, so the motion is already finishing
    // by the time the element is somewhere the eye is resting.
    { rootMargin: '0px 0px -10% 0px', threshold: 0.02 },
  )
  return observer
}

export const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    const still =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const io = still ? undefined : ensureObserver()
    if (!io || typeof el.animate !== 'function') return
    if (binding.value) el.dataset.revealStep = String(binding.value)
    // Hidden only now that everything needed to un-hide it is known to exist.
    el.style.opacity = '0'
    io.observe(el)
  },
  unmounted(el) {
    observer?.unobserve(el)
  },
}
