import { Actions, DockLocation, Model, TabSetNode } from 'flexlayout-react'
import { describe, expect, it } from 'vitest'

import type { WorkspaceDocument } from '../domain/workspace'
import {
  activeDocumentId,
  addDocumentSplit,
  createDocumentTabJson,
  createWorkbenchModel,
  focusDocument,
  isWorkbenchLayoutActionAllowed,
  normalizeLayoutJson,
  removeDocumentPane,
  replaceDocumentInPane,
  restoreWorkspaceModel,
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
  it('creates a constrained document tab for external drawer docking', () => {
    expect(createDocumentTabJson(document('one'))).toEqual({
      type: 'tab',
      component: 'document',
      name: 'one.md',
      helpText: 'notes/one.md',
      config: { documentId: 'one' },
      enableClose: false,
      enablePopout: false,
      enableRename: false,
    })
  })

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

  it('prunes the empty source pane when an existing tab is redocked', () => {
    const model = createWorkbenchModel(document('one'))
    addDocumentSplit(model, document('two'), 'right')
    const targetPane = model.getActiveTabset()
    if (!targetPane) throw new Error('Expected the target pane')

    model.doAction(Actions.moveNode(
      'workbench-tab-1',
      targetPane.getId(),
      DockLocation.TOP,
      -1,
      true,
    ))

    const tabsets: TabSetNode[] = []
    model.visitNodes((node) => {
      if (node instanceof TabSetNode) tabsets.push(node)
    })
    expect(tabsets).toHaveLength(2)
    expect(tabsets.every((tabset) => tabset.getChildren().length === 1)).toBe(true)
    expect(new Set(visibleDocumentIds(model)).size).toBe(2)
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

  it('restores valid panes while dropping unknown and duplicate documents', () => {
    const model = createWorkbenchModel(document('one'))
    addDocumentSplit(model, document('two'), 'right')
    const json = model.toJson()
    const secondPane = json.layout.children?.[1]
    if (!secondPane || secondPane.type !== 'tabset') throw new Error('Expected second pane')
    secondPane.weight = 37
    secondPane.children = [
      ...(secondPane.children ?? []),
      {
        type: 'tab',
        id: 'duplicate-one',
        name: 'duplicate',
        component: 'document',
        config: { documentId: 'one' },
      },
      {
        type: 'tab',
        id: 'unknown',
        name: 'unknown',
        component: 'document',
        config: { documentId: 'unknown' },
      },
    ]

    const restored = restoreWorkspaceModel(json, [document('one'), document('two')], 'two')

    expect(visibleDocumentIds(restored)).toEqual(['one', 'two'])
    expect(activeDocumentId(restored)).toBe('two')
    expect(restored.toJson().layout.children?.[1]?.weight).toBe(37)
  })

  it('falls back to the preferred document for corrupt or stale layouts', () => {
    const documents = [document('one'), document('two')]
    const corrupt = restoreWorkspaceModel({ invalid: true }, documents, 'two')
    const stale = createWorkbenchModel(document('one')).toJson()
    const tabset = stale.layout.children?.[0]
    if (!tabset || tabset.type !== 'tabset') throw new Error('Expected tabset')
    tabset.children = [
      {
        type: 'tab',
        name: 'missing',
        component: 'document',
        config: { documentId: 'missing' },
      },
    ]

    expect(visibleDocumentIds(corrupt)).toEqual(['two'])
    expect(visibleDocumentIds(restoreWorkspaceModel(stale, documents, 'two'))).toEqual(['two'])
  })
})
