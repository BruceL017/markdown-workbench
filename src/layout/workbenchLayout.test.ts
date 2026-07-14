import { Actions, DockLocation, Model, TabSetNode } from 'flexlayout-react'
import { describe, expect, it } from 'vitest'

import type { WorkspaceDocument } from '../domain/workspace'
import {
  activeDocumentId,
  addDocumentSplit,
  createWorkbenchModel,
  focusDocument,
  isWorkbenchLayoutActionAllowed,
  normalizeLayoutJson,
  removeDocumentPane,
  replaceDocumentInPane,
  serializeWorkbenchLayout,
  visibleDocumentIds,
} from './workbenchLayout'

function document(id: string): WorkspaceDocument {
  return {
    id,
    name: `${id}.md`,
    virtualPath: `notes/${id}.md`,
    text: `# ${id}`,
    savedText: `# ${id}`,
    dirty: false,
    sourceKind: 'fallback',
    viewMode: 'preview',
    updatedAt: 1,
  }
}

describe('workbench layout', () => {
  it('starts with one document and creates four deterministic split directions', () => {
    for (const [direction, expectedLocation] of [
      ['left', DockLocation.LEFT],
      ['right', DockLocation.RIGHT],
      ['top', DockLocation.TOP],
      ['bottom', DockLocation.BOTTOM],
    ] as const) {
      const model = createWorkbenchModel(document('one'))
      const activePane = model.getActiveTabset()

      expect(activePane).toBeInstanceOf(TabSetNode)
      addDocumentSplit(model, document('two'), direction, activePane?.getId())

      expect(visibleDocumentIds(model)).toEqual(
        direction === 'left' || direction === 'top' ? ['two', 'one'] : ['one', 'two'],
      )
      expect(activeDocumentId(model)).toBe('two')
      expect(expectedLocation.getName()).toBe(direction)
    }
  })

  it('replaces the active pane while keeping the previous document buffered outside layout', () => {
    const model = createWorkbenchModel(document('one'))

    replaceDocumentInPane(model, document('two'))

    expect(visibleDocumentIds(model)).toEqual(['two'])
    expect(activeDocumentId(model)).toBe('two')
  })

  it('focuses an already visible document instead of creating a duplicate', () => {
    const model = createWorkbenchModel(document('one'))
    addDocumentSplit(model, document('two'), 'right')

    expect(focusDocument(model, 'one')).toBe(true)
    expect(activeDocumentId(model)).toBe('one')
    expect(visibleDocumentIds(model)).toEqual(['one', 'two'])
  })

  it('rejects center add and move actions but allows edge docking', () => {
    const centerMove = Actions.moveNode('tab:a', 'pane:b', DockLocation.CENTER, -1)
    const centerAdd = Actions.addTab(
      { type: 'tab', component: 'document', name: 'a' },
      'pane:b',
      DockLocation.CENTER,
      -1,
    )
    const edgeMove = Actions.moveNode('tab:a', 'pane:b', DockLocation.LEFT, -1)

    expect(isWorkbenchLayoutActionAllowed(centerMove)).toBe(false)
    expect(isWorkbenchLayoutActionAllowed(centerAdd)).toBe(false)
    expect(isWorkbenchLayoutActionAllowed(edgeMove)).toBe(true)
  })

  it('normalizes restored JSON to one tab per pane and one pane per document', () => {
    const malformed = createWorkbenchModel(document('one')).toJson()
    const tabset = malformed.layout.children?.[0]
    if (!tabset || tabset.type !== 'tabset') throw new Error('Expected tabset')
    tabset.children = [
      ...(tabset.children ?? []),
      {
        type: 'tab',
        id: 'duplicate-one',
        name: 'duplicate',
        component: 'document',
        config: { documentId: 'one' },
      },
      {
        type: 'tab',
        id: 'two',
        name: 'two',
        component: 'document',
        config: { documentId: 'two' },
      },
    ]

    const normalized = normalizeLayoutJson(malformed)
    const restored = Model.fromJson(normalized)

    expect(visibleDocumentIds(restored)).toEqual(['one'])
    expect(serializeWorkbenchLayout(restored)).toEqual(normalized)
  })

  it('reopens a buffered document after the last pane is closed', () => {
    const model = createWorkbenchModel(document('one'))

    removeDocumentPane(model, 'one')
    replaceDocumentInPane(model, document('two'))

    expect(visibleDocumentIds(model)).toEqual(['two'])
    expect(activeDocumentId(model)).toBe('two')
  })
})
