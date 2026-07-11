import { describe, it, expect } from 'vitest'
import {
  parseGithubRemote,
  isoToGitTime,
  gitTimeToIso,
  apiTreeMode,
  localTreeMode,
} from './github'

describe('parseGithubRemote', () => {
  it('parses ssh scp-style URLs (the common clone form)', () => {
    expect(parseGithubRemote('git@github.com:whitefoxx/my-trace.git')).toEqual({
      owner: 'whitefoxx',
      repo: 'my-trace',
    })
  })
  it('parses https URLs with and without .git', () => {
    expect(parseGithubRemote('https://github.com/octocat/Hello-World.git')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    })
    expect(parseGithubRemote('https://github.com/octocat/Hello-World')).toEqual({
      owner: 'octocat',
      repo: 'Hello-World',
    })
  })
  it('parses ssh:// protocol URLs', () => {
    expect(parseGithubRemote('ssh://git@github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' })
  })
  it('rejects non-github remotes', () => {
    expect(parseGithubRemote('git@gitlab.com:o/r.git')).toBeNull()
    expect(parseGithubRemote('/local/path')).toBeNull()
  })
})

describe('git time ↔ ISO round trip (sha-critical)', () => {
  it('converts +08:00 ISO to the JS offset convention', () => {
    expect(isoToGitTime('2026-07-11T10:00:00+08:00')).toEqual({
      timestamp: 1783735200,
      timezoneOffset: -480,
    })
  })
  it('handles Z (UTC)', () => {
    expect(isoToGitTime('2026-07-11T02:00:00Z')).toEqual({
      timestamp: 1783735200,
      timezoneOffset: 0,
    })
  })
  it('handles negative offsets', () => {
    const t = isoToGitTime('2012-03-06T15:06:50-08:00')
    expect(t.timezoneOffset).toBe(480)
  })
  it('round-trips timestamp+offset → ISO → timestamp+offset', () => {
    const iso = gitTimeToIso(1783735200, -480)
    expect(iso).toBe('2026-07-11T10:00:00+08:00')
    expect(isoToGitTime(iso)).toEqual({ timestamp: 1783735200, timezoneOffset: -480 })
  })
  it('round-trips UTC and western offsets', () => {
    expect(isoToGitTime(gitTimeToIso(1331075210, 480))).toEqual({
      timestamp: 1331075210,
      timezoneOffset: 480,
    })
    expect(gitTimeToIso(1331075210, 0)).toMatch(/\+00:00$/)
  })
})

describe('tree mode normalization', () => {
  it('adds the leading zero for the API, strips it locally', () => {
    expect(apiTreeMode('40000')).toBe('040000')
    expect(localTreeMode('040000')).toBe('40000')
    expect(apiTreeMode('100644')).toBe('100644')
    expect(localTreeMode('100644')).toBe('100644')
    expect(apiTreeMode('120000')).toBe('120000')
  })
})
