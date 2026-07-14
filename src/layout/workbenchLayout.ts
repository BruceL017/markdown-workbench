import {
  Actions,
  DockLocation,
  Model,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
  type IJsonRowNode,
  type IJsonTabNode,
  type IJsonTabSetNode,
} from 'flexlayout-react'

import type { WorkspaceDocument } from '../domain/workspace'

export type SplitDirection = 'left' | 'right' | 'top' | 'bottom'

const directionLocation: Record<SplitDirection, DockLocation> = {
  left: DockLocation.LEFT,
  right: DockLocation.RIGHT,
  top: DockLocation.TOP,
  bottom: DockLocation.BOTTOM,
}

const constrainedGlobals: NonNullable<IJsonModel['global']> = {
  enableEdgeDock: true,
  enableEdgeDockIndicators: true,
  tabEnableClose: false,
  tabEnableDrag: true,
  tabEnablePopout: false,
  tabEnableRename: false,
  tabEnableRenderOnDemand: false,
  tabSetEnableClose: false,
  tabSetEnableCloseButton: false,
  tabSetEnableDivide: true,
  tabSetEnableDrag: true,
  tabSetEnableDrop: true,
  tabSetEnableMaximize: false,
  tabSetEnableTabStrip: true,
  tabSetMinHeight: 160,
  tabSetMinWidth: 260,
}

export function createWorkbenchModel(document?: WorkspaceDocument): Model {
  const json: IJsonModel = {
    global: { ...constrainedGlobals },
    borders: [],
    layout: {
      type: 'row',
      id: 'workbench-root',
      children: [
        {
          type: 'tabset',
          id: 'workbench-pane-1',
          active: true,
          children: document ? [documentTab(document, 'workbench-tab-1')] : [],
        },
      ],
    },
  }

  return configureWorkbenchModel(Model.fromJson(json))
}

export function restoreWorkbenchModel(json: IJsonModel): Model {
  return configureWorkbenchModel(Model.fromJson(normalizeLayoutJson(json)))
}

export function configureWorkbenchModel(model: Model): Model {
  model.setOnAllowDrop((_dragNode, dropInfo) => dropInfo.location !== DockLocation.CENTER)
  return model
}

export function isWorkbenchLayoutActionAllowed(action: Action): boolean {
  if (action.type !== Actions.ADD_TAB && action.type !== Actions.MOVE_NODE) return true
  return action.data.location !== DockLocation.CENTER.getName()
}

export function documentIdForTab(node: TabNode): string | undefined {
  const config = node.getConfig() as { documentId?: unknown } | undefined
  return typeof config?.documentId === 'string' ? config.documentId : undefined
}

export function visibleDocumentIds(model: Model): string[] {
  const ids: string[] = []
  model.visitNodes((node) => {
    if (!(node instanceof TabNode)) return
    const documentId = documentIdForTab(node)
    if (documentId) ids.push(documentId)
  })
  return ids
}

export function activeDocumentId(model: Model): string | null {
  const selectedNode = model.getActiveTabset()?.getSelectedNode()
  return selectedNode instanceof TabNode ? documentIdForTab(selectedNode) ?? null : null
}

export function focusDocument(model: Model, documentId: string): boolean {
  const tab = findDocumentTab(model, documentId)
  if (!tab) return false

  model.doAction(Actions.selectTab(tab.getId()))
  const parent = tab.getParent()
  if (parent instanceof TabSetNode) {
    model.doAction(Actions.setActiveTabset(parent.getId()))
  }
  return true
}

export function replaceDocumentInPane(
  model: Model,
  document: WorkspaceDocument,
  paneId?: string,
): void {
  if (focusDocument(model, document.id)) return

  const target = paneFor(model, paneId)
  if (!target) return
  const currentTab = target.getChildren()[0]

  if (currentTab instanceof TabNode) {
    model.doAction(
      Actions.updateNodeAttributes(currentTab.getId(), {
        name: document.name,
        config: { documentId: document.id },
        helpText: document.virtualPath,
      }),
    )
    model.doAction(Actions.selectTab(currentTab.getId()))
  } else {
    model.doAction(
      Actions.addTab(
        documentTab(document, nextTabId(model)),
        target.getId(),
        DockLocation.CENTER,
        -1,
        true,
      ),
    )
  }

  model.doAction(Actions.setActiveTabset(target.getId()))
}

export function addDocumentSplit(
  model: Model,
  document: WorkspaceDocument,
  direction: SplitDirection,
  paneId?: string,
): void {
  if (focusDocument(model, document.id)) return

  const target = paneFor(model, paneId)
  if (!target || target.getChildren().length === 0) {
    replaceDocumentInPane(model, document, target?.getId())
    return
  }

  const addedNode = model.doAction(
    Actions.addTab(
      documentTab(document, nextTabId(model)),
      target.getId(),
      directionLocation[direction],
      -1,
      true,
    ),
  )

  if (addedNode instanceof TabNode && addedNode.getParent() instanceof TabSetNode) {
    model.doAction(Actions.setActiveTabset(addedNode.getParent()?.getId()))
  }
}

export function removeDocumentPane(model: Model, documentId: string): boolean {
  const tab = findDocumentTab(model, documentId)
  if (!tab) return false
  model.doAction(Actions.deleteTab(tab.getId()))
  return true
}

export function paneIdForDocument(model: Model, documentId: string): string | undefined {
  const parent = findDocumentTab(model, documentId)?.getParent()
  return parent instanceof TabSetNode ? parent.getId() : undefined
}

export function serializeWorkbenchLayout(model: Model): IJsonModel {
  return normalizeLayoutJson(model.toJson())
}

export function normalizeLayoutJson(input: IJsonModel): IJsonModel {
  const json = structuredClone(input)
  const seenDocuments = new Set<string>()
  let paneIndex = 0

  const normalizeRow = (row: IJsonRowNode) => {
    row.type = 'row'
    row.children = (row.children ?? []).map((child) => {
      if (child.type === 'row') {
        normalizeRow(child)
        return child
      }

      paneIndex += 1
      return normalizeTabset(child, seenDocuments, paneIndex)
    })
  }

  normalizeRow(json.layout)
  if (!json.layout.children?.length) {
    json.layout.children = [emptyTabset(1)]
  }

  json.global = { ...json.global, ...constrainedGlobals }
  json.borders = []
  delete json.subLayouts
  delete json.popouts
  return json
}

function normalizeTabset(
  tabset: IJsonTabSetNode,
  seenDocuments: Set<string>,
  paneIndex: number,
): IJsonTabSetNode {
  const child = (tabset.children ?? []).find((candidate) => {
    const documentId = documentIdFromJson(candidate)
    return Boolean(documentId && !seenDocuments.has(documentId))
  })
  if (child) {
    seenDocuments.add(documentIdFromJson(child) as string)
  }
  const children = child ? [child] : []

  return {
    ...tabset,
    type: 'tabset',
    id: tabset.id ?? `workbench-pane-${paneIndex}`,
    selected: children.length ? 0 : undefined,
    children,
  }
}

function emptyTabset(index: number): IJsonTabSetNode {
  return {
    type: 'tabset',
    id: `workbench-pane-${index}`,
    children: [],
  }
}

function documentTab(document: WorkspaceDocument, id: string): IJsonTabNode {
  return {
    type: 'tab',
    id,
    component: 'document',
    name: document.name,
    helpText: document.virtualPath,
    config: { documentId: document.id },
    enableClose: false,
    enablePopout: false,
    enableRename: false,
  }
}

function documentIdFromJson(tab: IJsonTabNode): string | undefined {
  const config = tab.config as { documentId?: unknown } | undefined
  return typeof config?.documentId === 'string' ? config.documentId : undefined
}

function findDocumentTab(model: Model, documentId: string): TabNode | undefined {
  let match: TabNode | undefined
  model.visitNodes((node) => {
    if (!match && node instanceof TabNode && documentIdForTab(node) === documentId) {
      match = node
    }
  })
  return match
}

function paneFor(model: Model, paneId?: string): TabSetNode | undefined {
  const requested = paneId ? model.getNodeById(paneId) : undefined
  if (requested instanceof TabSetNode) return requested
  return model.getActiveTabset() ?? model.getFirstTabSet()
}

function nextTabId(model: Model): string {
  let index = 1
  while (model.getNodeById(`workbench-tab-${index}`)) index += 1
  return `workbench-tab-${index}`
}
