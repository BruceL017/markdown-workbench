import { describe, expect, it } from 'vitest'

import { normalizeWorkspacePath, resolveResourceTarget } from './virtualPath'

describe('normalizeWorkspacePath', () => {
  it('normalizes POSIX workspace paths', () => {
    expect(normalizeWorkspacePath('notes//drafts/./post.md')).toBe('notes/drafts/post.md')
  })

  it.each(['../outside.png', '/etc/passwd', 'C:/secret.txt', 'notes\\image.png'])(
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

  it('rejects a reference that traverses above the workspace root', () => {
    expect(resolveResourceTarget('notes/post.md', '../../outside.png')).toMatchObject({
      kind: 'rejected',
    })
  })
})
