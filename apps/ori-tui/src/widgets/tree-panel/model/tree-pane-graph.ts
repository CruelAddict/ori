import { NodeType, type Node, type NodeEdge } from "@shared/lib/configurations-client"
import type { Accessor } from "solid-js"
import { batch, createEffect, createMemo, createSignal } from "solid-js"
import { createStore, produce, type SetStoreFunction } from "solid-js/store"
import { createEdgeTreePaneNode, createSnapshotTreePaneNode, type TreePaneNode } from "./tree-pane-node"

const CHILD_BATCH_SIZE = 10

export type VisibleRow = {
  id: string
  parentId?: string
  depth: number
}

export function convertSnapshotNodeEntities(node: Node, nodes: Record<string, Node>): TreePaneNode[] {
  const entities: TreePaneNode[] = []
  const nodeEntity = createSnapshotTreePaneNode(node)
  entities.push(nodeEntity)

  const attachEdgeEntity = (edgeEntity: ReturnType<typeof createEdgeTreePaneNode>, hasChildren: boolean) => {
    edgeEntity.hasChildren = hasChildren
    nodeEntity.childIds.push(edgeEntity.id)
    nodeEntity.hasChildren = nodeEntity.childIds.length > 0
    entities.push(edgeEntity)
  }

  const attachSyntheticEdge = (edgeName: string, labels: string[]) => {
    if (labels.length === 0) return
    const childIds: string[] = []
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index]
      const childId = `synthetic:${node.id}:${edgeName}:${index}`
      const childNode: Node = {
        id: childId,
        type: NodeType.COLUMN,
        name: label,
        attributes: {
          connection: "synthetic",
          table: node.name,
          column: label,
          ordinal: index,
          dataType: "",
          notNull: false,
        },
        edges: {},
      }
      const childEntity = createSnapshotTreePaneNode(childNode)
      entities.push(childEntity)
      childIds.push(childEntity.id)
    }
    if (childIds.length === 0) return
    const edgeEntity = createEdgeTreePaneNode(node, edgeName, {
      items: childIds,
      truncated: false,
    })
    attachEdgeEntity(edgeEntity, true)
  }

  if (node.type === NodeType.INDEX) {
    attachSyntheticEdge("columns", node.attributes.columns ?? [])
    attachSyntheticEdge("include", node.attributes.includeColumns ?? [])
  }

  if (node.type === NodeType.CONSTRAINT) {
    attachSyntheticEdge("columns", node.attributes.columns ?? [])
    attachSyntheticEdge("references", node.attributes.referencedColumns ?? [])
  }

  const entries = Object.entries(node.edges) as Array<[string, NodeEdge]>
  for (const [edgeName, edge] of entries) {
    if (!edge.items || edge.items.length === 0) {
      continue
    }
    const edgeEntity = createEdgeTreePaneNode(node, edgeName, edge)
    const hasChildren = edgeEntity.childIds.some((childId) => Boolean(nodes[childId]))
    attachEdgeEntity(edgeEntity, hasChildren)
  }

  return entities
}

export function useTreePaneGraph(nodesById: Accessor<Record<string, Node>>, rootIds: Accessor<string[]>) {
  const [entitiesById, setEntitiesById] = createStore<Record<string, TreePaneNode>>({})
  const processedNodeIds = new Set<string>()
  const edgeIdsByChildId = new Map<string, Set<string>>()

  const getEntity = (id: string) => entitiesById[id]

  // Fine-grained per-node stores for expansion and loaded-children counts
  const [expandedNodes, setExpandedNodes] = createStore<Record<string, true>>({})
  const [visibleChildCounts, setVisibleChildCounts] = createStore<Record<string, number>>({})
  const [selectedId, setSelectedId] = createSignal<string | null>(null)

  const isNodeExpanded = (nodeId: string | null) => (nodeId ? Boolean(expandedNodes[nodeId]) : false)
  const getVisibleCount = (nodeId: string) => visibleChildCounts[nodeId] ?? 0

  const rootIdsMemo = createMemo(() => rootIds())

  // Derived flat rows for navigation/scroll. Rendering can be recursive and read helpers directly.
  const visibleRows = createMemo(() => buildVisibleRows(rootIdsMemo(), getEntity, isNodeExpanded, getVisibleCount))

  const rowIndexMap = createMemo(() => {
    const list = visibleRows()
    const map = new Map<string, number>()
    for (let index = 0; index < list.length; index += 1) {
      map.set(list[index]?.id, index)
    }
    return map
  })

  const selectedRow = createMemo(() => {
    const id = selectedId()
    if (!id) return null
    const index = rowIndexMap().get(id)
    if (index === undefined) return null
    return visibleRows()[index] ?? null
  })

  setupTreeEffects({
    rootIds: rootIdsMemo,
    getEntity,
    setExpandedNodes,
    setVisibleChildCounts,
    selectedId,
    setSelectedId,
    visibleRows,
    rowIndexMap,
  })

  const childVisibility = createChildVisibilityManager({
    getEntity,
    isNodeExpanded,
    getVisibleCount,
    setVisibleChildCounts,
  })

  const registerEdgeChildren = (edgeId: string, childIds: string[]) => {
    for (const childId of childIds) {
      const entry = edgeIdsByChildId.get(childId)
      if (entry) {
        entry.add(edgeId)
      } else {
        edgeIdsByChildId.set(childId, new Set([edgeId]))
      }
    }
  }

  const updateEdgesForChild = (childId: string) => {
    const edgeIds = edgeIdsByChildId.get(childId)
    if (!edgeIds) return
    for (const edgeId of edgeIds) {
      const edgeEntity = getEntity(edgeId)
      if (!edgeEntity) continue
      if (!edgeEntity.hasChildren) {
        setEntitiesById(edgeId, "hasChildren", true)
      }
      if (isNodeExpanded(edgeId)) {
        childVisibility.ensureInitialChildren(edgeId)
        childVisibility.scheduleAutoLoad(edgeId)
      }
    }
  }

  const clearSnapshotState = () => {
    processedNodeIds.clear()
    edgeIdsByChildId.clear()
    setEntitiesById({})
  }

  const applySnapshotNode = (node: Node, nodes: Record<string, Node>) => {
    const entities = convertSnapshotNodeEntities(node, nodes)
    for (const entity of entities) {
      setEntitiesById(entity.id, entity)
      if (entity.kind === "edge") {
        registerEdgeChildren(entity.id, entity.childIds)
      }
    }
    updateEdgesForChild(node.id)
  }

  createEffect(() => {
    const nodes = nodesById()
    const ids = Object.keys(nodes)
    if (ids.length === 0) {
      if (processedNodeIds.size > 0) {
        clearSnapshotState()
      }
      return
    }

    for (const id of ids) {
      if (processedNodeIds.has(id)) continue
      const node = nodes[id]
      if (!node) continue
      processedNodeIds.add(id)
      applySnapshotNode(node, nodes)
    }
  })

  const selectNode = (nodeId: string | null) => setSelectedId(nodeId)

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return
    const entity = getEntity(nodeId)
    if (!entity?.hasChildren) return
    if (isNodeExpanded(nodeId)) return
    setExpandedNodes(nodeId, true)
    childVisibility.ensureInitialChildren(nodeId)
    childVisibility.scheduleAutoLoad(nodeId)
  }

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return
    if (!isNodeExpanded(nodeId)) return
    setExpandedNodes(
      produce((state) => {
        delete state[nodeId]
      }),
    )
  }

  const moveSelection = createMoveSelectionAction({
    visibleRows,
    rowIndexMap,
    selectedId,
    selectNode,
  })

  const focusFirstChild = createFocusFirstChildAction({
    selectedRow,
    getEntity,
    expandNode,
    ensureInitialChildren: childVisibility.ensureInitialChildren,
    selectNode,
  })

  const collapseCurrentOrParent = createCollapseCurrentOrParentAction({
    selectedRow,
    getEntity,
    collapseNode,
    selectNode,
    isNodeExpanded,
  })

  const activateSelection = createActivateSelectionAction({
    selectedRow,
    getEntity,
    collapseNode,
    expandNode,
    isNodeExpanded,
  })

  return {
    rootIds,
    visibleRows,
    selectedId,
    selectedRow,
    expandNode,
    collapseNode,
    moveSelection,
    focusFirstChild,
    collapseCurrentOrParent,
    selectNode,
    isExpanded: (nodeId: string | null) => isNodeExpanded(nodeId),
    getEntity: (nodeId: string | null) => (nodeId ? entitiesById[nodeId] : undefined),
    getVisibleChildIds: childVisibility.getVisibleChildIds,
    getRenderableChildIds: childVisibility.getRenderableChildIds,
    activateSelection,
  }
}

function buildVisibleRows(
  rootIds: readonly string[],
  getEntity: (id: string) => TreePaneNode | undefined,
  isExpanded: (id: string) => boolean,
  getVisibleCount: (id: string) => number,
): VisibleRow[] {
  const rows: VisibleRow[] = []
  for (const rootId of rootIds) {
    const entity = getEntity(rootId)
    if (!entity) continue
    rows.push({ id: entity.id, depth: 0 })
    if (entity.hasChildren && isExpanded(entity.id)) {
      appendVisibleChildren(rows, entity.id, 1, getEntity, isExpanded, getVisibleCount)
    }
  }
  return rows
}

function appendVisibleChildren(
  list: VisibleRow[],
  parentId: string,
  depth: number,
  getEntity: (id: string) => TreePaneNode | undefined,
  isExpanded: (id: string) => boolean,
  getVisibleCount: (id: string) => number,
): void {
  const parent = getEntity(parentId)
  if (!parent) return
  const visibleCount = Math.min(getVisibleCount(parentId), parent.childIds.length)
  for (let index = 0; index < visibleCount; index += 1) {
    const childId = parent.childIds[index]
    if (!childId) continue
    const child = getEntity(childId)
    if (!child) continue
    list.push({ id: child.id, depth, parentId })
    if (child.hasChildren && isExpanded(child.id)) {
      appendVisibleChildren(list, child.id, depth + 1, getEntity, isExpanded, getVisibleCount)
    }
  }
}

type TreeEffectsOptions = {
  rootIds: Accessor<string[]>
  getEntity: (id: string) => TreePaneNode | undefined
  setExpandedNodes: SetStoreFunction<Record<string, true>>
  setVisibleChildCounts: SetStoreFunction<Record<string, number>>
  selectedId: Accessor<string | null>
  setSelectedId: (value: string | null) => void
  visibleRows: Accessor<VisibleRow[]>
  rowIndexMap: Accessor<Map<string, number>>
}

function setupTreeEffects(options: TreeEffectsOptions) {
  createEffect(() => {
    options.setExpandedNodes(
      produce<Record<string, true>>((state) => {
        for (const id of Object.keys(state)) {
          if (!options.getEntity(id)) delete state[id]
        }
      }),
    )
    options.setVisibleChildCounts(
      produce<Record<string, number>>((counts) => {
        for (const id of Object.keys(counts)) {
          if (!options.getEntity(id)) delete counts[id]
        }
      }),
    )
  })

  createEffect(() => {
    const rootIds = options.rootIds()
    if (rootIds.length === 0) {
      batch(() => {
        options.setSelectedId(null)
      })
      return
    }
    const rows = options.visibleRows()
    if (!rows.length) {
      options.setSelectedId(null)
      return
    }
    const current = options.selectedId()
    if (!current) {
      options.setSelectedId(rows[0]?.id ?? null)
      return
    }
    const rowIndex = options.rowIndexMap().get(current)
    if (rowIndex !== undefined) {
      return
    }
    if (options.getEntity(current)) {
      return
    }
    options.setSelectedId(rows[0]?.id ?? null)
  })
}

type ChildVisibilityOptions = {
  getEntity: (id: string) => TreePaneNode | undefined
  isNodeExpanded: (nodeId: string | null) => boolean
  getVisibleCount: (nodeId: string) => number
  setVisibleChildCounts: SetStoreFunction<Record<string, number>>
}

function createChildVisibilityManager(options: ChildVisibilityOptions) {
  let queue = new Set<string>()
  let handle: ReturnType<typeof setTimeout> | null = null

  const ensureInitialChildren = (nodeId: string) => {
    const entity = options.getEntity(nodeId)
    if (!entity?.hasChildren) return
    const limit = Math.min(entity.childIds.length, CHILD_BATCH_SIZE)
    options.setVisibleChildCounts(nodeId, (currentValue: number | undefined) => {
      const current = currentValue ?? 0
      return current >= limit ? current : limit
    })
  }

  const scheduleAutoLoad = (nodeId: string) => {
    const entity = options.getEntity(nodeId)
    if (!entity?.hasChildren) return
    if (options.getVisibleCount(nodeId) >= entity.childIds.length) return
    queue.add(nodeId)
    if (handle === null) {
      handle = setTimeout(runAutoLoadCycle, 0)
    }
  }

  const runAutoLoadCycle = () => {
    handle = null
    if (queue.size === 0) return
    const pending = new Set<string>()
    for (const nodeId of queue) {
      if (!options.isNodeExpanded(nodeId)) continue
      const entity = options.getEntity(nodeId)
      if (!entity?.childIds.length) continue
      const baseline = options.getVisibleCount(nodeId)
      if (baseline >= entity.childIds.length) continue
      const target = Math.min(entity.childIds.length, baseline + CHILD_BATCH_SIZE)
      if (target === baseline) continue
      options.setVisibleChildCounts(nodeId, target)
      if (target < entity.childIds.length) {
        pending.add(nodeId)
      }
    }
    queue = pending
    if (queue.size) {
      handle = setTimeout(runAutoLoadCycle, 0)
    }
  }

  const sliceChildren = (nodeId: string) => {
    const entity = options.getEntity(nodeId)
    if (!entity) return [] as string[]
    const count = options.getVisibleCount(nodeId)
    if (count <= 0) return [] as string[]
    const result: string[] = []
    for (const childId of entity.childIds) {
      if (!childId) continue
      if (!options.getEntity(childId)) continue
      result.push(childId)
      if (result.length >= count) break
    }
    return result
  }

  return {
    ensureInitialChildren,
    scheduleAutoLoad,
    getVisibleChildIds: (nodeId: string) => {
      if (!options.isNodeExpanded(nodeId)) return []
      return sliceChildren(nodeId)
    },
    getRenderableChildIds: (nodeId: string) => sliceChildren(nodeId),
  }
}

type MoveSelectionOptions = {
  visibleRows: Accessor<VisibleRow[]>
  rowIndexMap: Accessor<Map<string, number>>
  selectedId: Accessor<string | null>
  selectNode: (nodeId: string | null) => void
}

function createMoveSelectionAction(options: MoveSelectionOptions) {
  return (delta: number) => {
    const list = options.visibleRows()
    if (!list.length) return
    const current = options.selectedId()
    const index = current ? (options.rowIndexMap().get(current) ?? -1) : -1
    const baseIndex = index === -1 ? 0 : index
    const nextIndex = Math.max(0, Math.min(list.length - 1, baseIndex + delta))
    options.selectNode(list[nextIndex]?.id ?? null)
  }
}

type FocusFirstChildOptions = {
  selectedRow: Accessor<VisibleRow | null>
  getEntity: (id: string) => TreePaneNode | undefined
  expandNode: (nodeId: string | null) => void
  ensureInitialChildren: (nodeId: string) => void
  selectNode: (nodeId: string | null) => void
}

function createFocusFirstChildAction(options: FocusFirstChildOptions) {
  return () => {
    const row = options.selectedRow()
    if (!row) return
    const entity = options.getEntity(row.id)
    if (!entity?.hasChildren) return
    let firstChildId: string | undefined
    for (const childId of entity.childIds) {
      if (options.getEntity(childId)) {
        firstChildId = childId
        break
      }
    }
    if (!firstChildId) return
    batch(() => {
      options.expandNode(row.id)
      options.ensureInitialChildren(row.id)
      options.selectNode(firstChildId)
    })
  }
}

type CollapseCurrentOrParentOptions = {
  selectedRow: Accessor<VisibleRow | null>
  getEntity: (id: string) => TreePaneNode | undefined
  collapseNode: (nodeId: string | null) => void
  selectNode: (nodeId: string | null) => void
  isNodeExpanded: (nodeId: string | null) => boolean
}

function createCollapseCurrentOrParentAction(options: CollapseCurrentOrParentOptions) {
  return () => {
    const row = options.selectedRow()
    if (!row) return
    const entity = options.getEntity(row.id)
    const expanded = entity?.hasChildren && options.isNodeExpanded(row.id)
    if (expanded) {
      options.collapseNode(row.id)
      return
    }
    if (row?.parentId) {
      options.collapseNode(row.parentId)
      options.selectNode(row.parentId)
    }
  }
}

type ActivateSelectionOptions = {
  selectedRow: Accessor<VisibleRow | null>
  getEntity: (id: string) => TreePaneNode | undefined
  collapseNode: (nodeId: string | null) => void
  expandNode: (nodeId: string | null) => void
  isNodeExpanded: (nodeId: string | null) => boolean
}

function createActivateSelectionAction(options: ActivateSelectionOptions) {
  return () => {
    const row = options.selectedRow()
    if (!row) return
    const entity = options.getEntity(row.id)
    if (!entity?.hasChildren) return
    if (options.isNodeExpanded(row.id)) {
      options.collapseNode(row.id)
      return
    }
    options.expandNode(row.id)
  }
}
