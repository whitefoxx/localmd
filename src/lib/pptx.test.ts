import { describe, it, expect } from 'vitest'
import { relsPathFor } from './pptx'

/* The zip/XML walk needs a DOM and is exercised in the browser (e2e); the
   slide-order/media path plumbing shares `resolvePart`, tested with xlsx. */

describe('relsPathFor', () => {
  it('locates a part\'s own rels file', () => {
    expect(relsPathFor('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
    expect(relsPathFor('ppt/presentation.xml')).toBe('ppt/_rels/presentation.xml.rels')
  })
})
