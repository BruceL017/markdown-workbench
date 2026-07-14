export interface LocalResourceTarget {
  kind: 'local'
  path: string
  query: string
  hash: string
}

export interface RemoteResourceTarget {
  kind: 'remote'
  url: string
}

export interface RejectedResourceTarget {
  kind: 'rejected'
  reason: string
}

export type ResourceTarget =
  | LocalResourceTarget
  | RemoteResourceTarget
  | RejectedResourceTarget

const schemePattern = /^[a-z][a-z\d+.-]*:/i
const drivePathPattern = /^[a-z]:($|\/)/i

export function normalizeWorkspacePath(path: string): string {
  if (!path || path.startsWith('/') || drivePathPattern.test(path)) {
    throw new Error('Workspace paths must be relative')
  }
  if (path.includes('\\')) {
    throw new Error('Workspace paths must use POSIX separators')
  }

  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) throw new Error('Path escapes the workspace root')
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  if (segments.length === 0) throw new Error('Workspace path is empty')
  return segments.join('/')
}

function rejected(error: unknown): RejectedResourceTarget {
  return {
    kind: 'rejected',
    reason: error instanceof Error ? error.message : 'Invalid resource target',
  }
}

function splitTarget(rawTarget: string) {
  const hashIndex = rawTarget.indexOf('#')
  const beforeHash = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : rawTarget.slice(hashIndex)
  const queryIndex = beforeHash.indexOf('?')

  return {
    path: queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex),
    query: queryIndex === -1 ? '' : beforeHash.slice(queryIndex),
    hash,
  }
}

export function resolveResourceTarget(
  markdownVirtualPath: string,
  rawTarget: string,
): ResourceTarget {
  const scheme = rawTarget.match(schemePattern)?.[0].slice(0, -1).toLowerCase()
  if (scheme === 'http' || scheme === 'https') {
    try {
      new URL(rawTarget)
      return { kind: 'remote', url: rawTarget }
    } catch (error) {
      return rejected(error)
    }
  }
  if (scheme) return rejected(new Error(`Unsupported URL scheme: ${scheme}`))

  try {
    const markdownPath = normalizeWorkspacePath(markdownVirtualPath)
    const target = splitTarget(rawTarget)
    if (!target.path) throw new Error('Resource path is empty')

    const decodedPath = target.path
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/')
    if (decodedPath.startsWith('/') || drivePathPattern.test(decodedPath)) {
      throw new Error('Resource paths must be relative')
    }
    const markdownDirectory = markdownPath.split('/').slice(0, -1).join('/')
    const path = normalizeWorkspacePath(
      markdownDirectory ? `${markdownDirectory}/${decodedPath}` : decodedPath,
    )

    return { kind: 'local', path, query: target.query, hash: target.hash }
  } catch (error) {
    return rejected(error)
  }
}
