import { describe, expect, it } from 'vitest'

import { normalizeWorkspacePath, resolveResourceTarget } from './virtualPath'

describe('normalizeWorkspacePath', () => {
  it('normalizes POSIX workspace paths', () => {
    expect(normalizeWorkspacePath('notes//drafts/./post.md')).toBe('notes/drafts/post.md')
  })

  it.each([
    '../outside.png',
    '/etc/passwd',
    'C:/secret.txt',
    'C:secret.txt',
    'dir/../C:secret.txt',
    'file:asset.png',
    'notes\\image.png',
  ])(
    'rejects unsafe path %s',
    (path) => {
      expect(() => normalizeWorkspacePath(path)).toThrow()
    },
  )
})

describe('resolveResourceTarget', () => {
  it('returns HTTP(S) URLs unchanged', () => {
    expect(resolveResourceTarget('notes/post.md', 'https://example.com/a%20b.png?q=1#hero')).toEqual({
      kind: 'remote',
      url: 'https://example.com/a%20b.png?q=1#hero',
    })
    expect(resolveResourceTarget('notes/post.md', 'http://example.com/image.png')).toEqual({
      kind: 'remote',
      url: 'http://example.com/image.png',
    })
  })

  it('resolves, decodes, and normalizes a local reference', () => {
    expect(
      resolveResourceTarget(
        'notes/guides/post.md',
        '../images//hero%20wide/./cover.png?width=800#preview',
      ),
    ).toEqual({
      kind: 'local',
      path: 'notes/images/hero wide/cover.png',
      query: '?width=800',
      hash: '#preview',
    })
  })

  it('preserves literal spaces in local file names', () => {
    expect(resolveResourceTarget('notes/post.md', 'images/hero wide.png')).toEqual({
      kind: 'local',
      path: 'notes/images/hero wide.png',
      query: '',
      hash: '',
    })
  })

  it('treats encoded parent segments as traversal', () => {
    expect(resolveResourceTarget('post.md', '%2e%2e/secret.png')).toMatchObject({
      kind: 'rejected',
    })
    expect(resolveResourceTarget('post.md', '%2e%2e%2fsecret.png')).toMatchObject({
      kind: 'rejected',
    })
  })

  it.each([
    'file:/tmp/image.png',
    'file:///tmp/image.png',
    'data:image/png;base64,abc',
    'mailto:test@example.com',
    '/absolute/image.png',
    'C:/absolute/image.png',
    'images\\cover.png',
    '%E0%A4%A',
  ])('rejects unsupported or unsafe target %s', (target) => {
    expect(resolveResourceTarget('notes/post.md', target)).toMatchObject({
      kind: 'rejected',
      reason: expect.any(String),
    })
  })

  it.each([
    'C:foo',
    'C%3Afoo',
    'c%3afoo',
    './c%3A%5Cfoo',
    './C:foo',
    'dir/../C:foo',
    '../C%3Afoo',
    'file%3A/tmp/image.png',
    'FiLe%3a%5Ctmp%5Cimage.png',
    'javascript%3Aalert(1)',
    './JAVASCRIPT%3aalert(1)',
    'mailto%3Atest@example.com',
    'https%3A//example.com/image.png',
  ])('rejects an encoded or normalized dangerous root %s', (target) => {
    expect(resolveResourceTarget('notes/post.md', target)).toMatchObject({
      kind: 'rejected',
      reason: expect.any(String),
    })
  })

  it('allows colons in non-root file names', () => {
    expect(resolveResourceTarget('notes/post.md', 'images/name:variant.png')).toEqual({
      kind: 'local',
      path: 'notes/images/name:variant.png',
      query: '',
      hash: '',
    })
    expect(resolveResourceTarget('notes/post.md', 'images/C:variant.png')).toEqual({
      kind: 'local',
      path: 'notes/images/C:variant.png',
      query: '',
      hash: '',
    })
  })

  it('rejects a reference that traverses above the workspace root', () => {
    expect(resolveResourceTarget('notes/post.md', '../../outside.png')).toMatchObject({
      kind: 'rejected',
    })
  })
})
