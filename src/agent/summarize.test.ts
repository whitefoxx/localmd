import { describe, it, expect } from 'vitest'
import { cleanTitle } from './summarize'

describe('cleanTitle', () => {
  it('keeps a six-word English title', () => {
    // The regression this guards: a 30-character cap threw titles like this
    // away, and the session kept the sliced first message instead.
    expect(cleanTitle('Fixing the session title generation bug')).toBe(
      'Fixing the session title generation bug',
    )
  })

  it('keeps a short Chinese title', () => {
    expect(cleanTitle('硬链接一句话解释')).toBe('硬链接一句话解释')
  })

  it('strips quoting and trailing punctuation', () => {
    expect(cleanTitle('  "Indexing a PDF".  ')).toBe('Indexing a PDF')
    expect(cleanTitle('《会话命名的来龙去脉》')).toBe('会话命名的来龙去脉')
  })

  it('takes the first line only', () => {
    expect(cleanTitle('Session titles\n\nHere is why that is the title.')).toBe('Session titles')
  })

  it('rejects a sentence and an empty reply', () => {
    expect(
      cleanTitle(
        'Sure! Here is a title for the conversation you pasted, though I should note that it covers several topics.',
      ),
    ).toBeNull()
    expect(cleanTitle('   ')).toBeNull()
  })
})
