import { describe, it, expect } from 'vitest'
import {
  anchoredScroll,
  clampZoom,
  fitZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  stepZoom,
  wheelZoom,
  zoomLabel,
} from '@/lib/zoom'

describe('stepZoom', () => {
  it('walks the ladder in both directions', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(0.5, 1)).toBe(0.75)
  })

  it('steps off a fit scale, which is never on the ladder', () => {
    expect(stepZoom(0.13, 1)).toBe(0.25)
    expect(stepZoom(0.13, -1)).toBe(0.1)
  })

  it('stops at the ends instead of running off them', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })
})

describe('fitZoom', () => {
  it('shrinks a full-page screenshot to the pane', () => {
    // 1280 × 12000 in a 900 × 700 pane: height decides.
    expect(fitZoom({ w: 1280, h: 12000 }, { w: 900, h: 700 })).toBeCloseTo(700 / 12000)
  })

  it('never blows a small picture up — fitting is not inventing pixels', () => {
    expect(fitZoom({ w: 200, h: 200 }, { w: 900, h: 700 })).toBe(1)
  })

  it('goes below the manual floor rather than cropping a very tall picture', () => {
    // MIN_ZOOM stops a PERSON zooming into nothing; it must not stop "show me
    // all of it" from showing all of it.
    expect(fitZoom({ w: 1280, h: 24000 }, { w: 900, h: 700 })).toBeLessThan(MIN_ZOOM)
  })

  it('answers 1 rather than NaN before anything has been measured', () => {
    expect(fitZoom({ w: 0, h: 0 }, { w: 900, h: 700 })).toBe(1)
    expect(fitZoom({ w: 100, h: 100 }, { w: 0, h: 0 })).toBe(1)
  })
})

describe('anchoredScroll', () => {
  it('keeps the point under the cursor where it is', () => {
    // Doubling: a point 100px into the view and 50px scrolled is at 150 in the
    // image, 300 after — so the scroll must be 300 - 100.
    expect(anchoredScroll(1, 2, { left: 50, top: 0 }, { x: 100, y: 0 }).left).toBe(200)
  })

  it('does not scroll to a negative offset when zooming out', () => {
    expect(anchoredScroll(2, 1, { left: 10, top: 10 }, { x: 5, y: 5 })).toEqual({
      left: 2.5,
      top: 2.5,
    })
    expect(anchoredScroll(8, 0.1, { left: 0, top: 0 }, { x: 400, y: 300 })).toEqual({
      left: 0,
      top: 0,
    })
  })
})

describe('wheelZoom', () => {
  it('zooms in on a scroll up and out on a scroll down', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1)
    expect(wheelZoom(1, 100)).toBeLessThan(1)
  })

  it('is smooth rather than laddered — a pinch is a slope, not a staircase', () => {
    const a = wheelZoom(1, -10)
    const b = wheelZoom(a, -10)
    expect(a).toBeGreaterThan(1)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(1.1)
  })

  it('cannot be pushed past the limits', () => {
    expect(wheelZoom(MAX_ZOOM, -100_000)).toBe(MAX_ZOOM)
    expect(wheelZoom(MIN_ZOOM, 100_000)).toBe(MIN_ZOOM)
  })
})

describe('clampZoom / zoomLabel', () => {
  it('holds the range and survives nonsense', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(NaN)).toBe(1)
  })

  it('prints whole percent', () => {
    expect(zoomLabel(1)).toBe('100%')
    expect(zoomLabel(0.0583)).toBe('6%')
  })
})
