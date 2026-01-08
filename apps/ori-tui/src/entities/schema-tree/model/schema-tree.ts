import type { Accessor } from "solid-js";
import { batch, createEffect, createMemo, createSignal } from "solid-js";
import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import type { GraphSnapshot } from "../api/graph";
import { buildNodeEntityMap, type NodeEntity } from "./node-entity";

const CHILD_BATCH_SIZE = 10;

export type VisibleRow = {
  id: string;
  parentId?: string;
  depth: number;
};

export function useSchemaTree(snapshot: Accessor<GraphSnapshot | null>) {
  const entityMap = createMemo(() => {
    const snap = snapshot();
    if (!snap) {
      return new Map<string, NodeEntity>();
    }
    return buildNodeEntityMap(snap.nodes);
  });

  // Fine-grained per-node stores for expansion and loaded-children counts
  const [expandedNodes, setExpandedNodes] = createStore<Record<string, true>>({});
  const [visibleChildCounts, setVisibleChildCounts] = createStore<Record<string, number>>({});
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  const isNodeExpanded = (nodeId: string | null) => (nodeId ? Boolean(expandedNodes[nodeId]) : false);
  const getVisibleCount = (nodeId: string) => visibleChildCounts[nodeId] ?? 0;

  const rootIds = createMemo(() => snapshot()?.rootIds ?? []);

  // Derived flat rows for navigation/scroll. Rendering can be recursive and read helpers directly.
  const visibleRows = createMemo(() => buildVisibleRows(rootIds(), entityMap(), isNodeExpanded, getVisibleCount));

  const rowIndexMap = createMemo(() => {
    const list = visibleRows();
    const map = new Map<string, number>();
    for (let index = 0; index < list.length; index += 1) {
      map.set(list[index]?.id, index);
    }
    return map;
  });

  const selectedRow = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    const index = rowIndexMap().get(id);
    if (index === undefined) return null;
    return visibleRows()[index] ?? null;
  });

  setupTreeEffects({
    snapshot,
    entityMap,
    setExpandedNodes,
    setVisibleChildCounts,
    selectedId,
    setSelectedId,
    visibleRows,
    rowIndexMap,
  });

  const childVisibility = createChildVisibilityManager({
    entityMap,
    isNodeExpanded,
    getVisibleCount,
    setVisibleChildCounts,
  });

  const selectNode = (nodeId: string | null) => setSelectedId(nodeId);

  const expandNode = (nodeId: string | null) => {
    if (!nodeId) return;
    const entity = entityMap().get(nodeId);
    if (!entity?.hasChildren) return;
    if (isNodeExpanded(nodeId)) return;
    setExpandedNodes(nodeId, true);
    childVisibility.ensureInitialChildren(nodeId);
    childVisibility.scheduleAutoLoad(nodeId);
  };

  const collapseNode = (nodeId: string | null) => {
    if (!nodeId) return;
    if (!isNodeExpanded(nodeId)) return;
    setExpandedNodes(
      produce((state) => {
        delete state[nodeId];
      }),
    );
  };

  const moveSelection = createMoveSelectionAction({
    visibleRows,
    rowIndexMap,
    selectedId,
    selectNode,
  });

  const focusFirstChild = createFocusFirstChildAction({
    selectedRow,
    entityMap,
    expandNode,
    ensureInitialChildren: childVisibility.ensureInitialChildren,
    selectNode,
  });

  const collapseCurrentOrParent = createCollapseCurrentOrParentAction({
    selectedRow,
    entityMap,
    collapseNode,
    selectNode,
    isNodeExpanded,
  });

  const activateSelection = createActivateSelectionAction({
    selectedRow,
    entityMap,
    collapseNode,
    expandNode,
    isNodeExpanded,
  });

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
    getEntity: (nodeId: string | null) => (nodeId ? entityMap().get(nodeId) : undefined),
    getVisibleChildIds: childVisibility.getVisibleChildIds,
    getRenderableChildIds: childVisibility.getRenderableChildIds,
    activateSelection,
  };
}

function buildVisibleRows(
  rootIds: readonly string[],
  entities: Map<string, NodeEntity>,
  isExpanded: (id: string) => boolean,
  getVisibleCount: (id: string) => number,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  for (const rootId of rootIds) {
    const entity = entities.get(rootId);
    if (!entity) continue;
    rows.push({ id: entity.id, depth: 0 });
    if (entity.hasChildren && isExpanded(entity.id)) {
      appendVisibleChildren(rows, entity.id, 1, entities, isExpanded, getVisibleCount);
    }
  }
  return rows;
}

function appendVisibleChildren(
  list: VisibleRow[],
  parentId: string,
  depth: number,
  entities: Map<string, NodeEntity>,
  isExpanded: (id: string) => boolean,
  getVisibleCount: (id: string) => number,
) {
  const parent = entities.get(parentId);
  if (!parent) return;
  const visibleCount = Math.min(getVisibleCount(parentId), parent.childIds.length);
  for (let index = 0; index < visibleCount; index += 1) {
    const childId = parent.childIds[index];
    if (!childId) continue;
    const child = entities.get(childId);
    if (!child) continue;
    list.push({ id: child.id, depth, parentId });
    if (child.hasChildren && isExpanded(child.id)) {
      appendVisibleChildren(list, child.id, depth + 1, entities, isExpanded, getVisibleCount);
    }
  }
}

type TreeEffectsOptions = {
  snapshot: Accessor<GraphSnapshot | null>;
  entityMap: Accessor<Map<string, NodeEntity>>;
  setExpandedNodes: SetStoreFunction<Record<string, true>>;
  setVisibleChildCounts: SetStoreFunction<Record<string, number>>;
  selectedId: Accessor<string | null>;
  setSelectedId: (value: string | null) => void;
  visibleRows: Accessor<VisibleRow[]>;
  rowIndexMap: Accessor<Map<string, number>>;
};

function setupTreeEffects(options: TreeEffectsOptions) {
  createEffect(() => {
    const map = options.entityMap();
    options.setExpandedNodes(
      produce<Record<string, true>>((state) => {
        for (const id of Object.keys(state)) {
          if (!map.has(id)) delete state[id];
        }
      }),
    );
    options.setVisibleChildCounts(
      produce<Record<string, number>>((counts) => {
        for (const id of Object.keys(counts)) {
          if (!map.has(id)) delete counts[id];
        }
      }),
    );
  });

  createEffect(() => {
    const snap = options.snapshot();
    if (!snap) {
      batch(() => {
        options.setSelectedId(null);
      });
      return;
    }
    const rows = options.visibleRows();
    if (!rows.length) {
      options.setSelectedId(null);
      return;
    }
    const current = options.selectedId();
    if (!current) {
      options.setSelectedId(rows[0]?.id ?? null);
      return;
    }
    const rowIndex = options.rowIndexMap().get(current);
    if (rowIndex !== undefined) {
      return;
    }
    if (options.entityMap().has(current)) {
      return;
    }
    options.setSelectedId(rows[0]?.id ?? null);
  });
}

type ChildVisibilityOptions = {
  entityMap: Accessor<Map<string, NodeEntity>>;
  isNodeExpanded: (nodeId: string | null) => boolean;
  getVisibleCount: (nodeId: string) => number;
  setVisibleChildCounts: SetStoreFunction<Record<string, number>>;
};

function createChildVisibilityManager(options: ChildVisibilityOptions) {
  let queue = new Set<string>();
  let handle: ReturnType<typeof setTimeout> | null = null;

  const ensureInitialChildren = (nodeId: string) => {
    const entity = options.entityMap().get(nodeId);
    if (!entity?.hasChildren) return;
    const limit = Math.min(entity.childIds.length, CHILD_BATCH_SIZE);
    options.setVisibleChildCounts(nodeId, (currentValue: number | undefined) => {
      const current = currentValue ?? 0;
      return current >= limit ? current : limit;
    });
  };

  const scheduleAutoLoad = (nodeId: string) => {
    const entity = options.entityMap().get(nodeId);
    if (!entity?.hasChildren) return;
    if (options.getVisibleCount(nodeId) >= entity.childIds.length) return;
    queue.add(nodeId);
    if (handle === null) {
      handle = setTimeout(runAutoLoadCycle, 0);
    }
  };

  const runAutoLoadCycle = () => {
    handle = null;
    if (queue.size === 0) return;
    const entities = options.entityMap();
    const pending = new Set<string>();
    for (const nodeId of queue) {
      if (!options.isNodeExpanded(nodeId)) continue;
      const entity = entities.get(nodeId);
      if (!entity?.childIds.length) continue;
      const baseline = options.getVisibleCount(nodeId);
      if (baseline >= entity.childIds.length) continue;
      const target = Math.min(entity.childIds.length, baseline + CHILD_BATCH_SIZE);
      if (target === baseline) continue;
      options.setVisibleChildCounts(nodeId, target);
      if (target < entity.childIds.length) {
        pending.add(nodeId);
      }
    }
    queue = pending;
    if (queue.size) {
      handle = setTimeout(runAutoLoadCycle, 0);
    }
  };

  const sliceChildren = (nodeId: string) => {
    const entity = options.entityMap().get(nodeId);
    if (!entity) return [] as string[];
    const count = options.getVisibleCount(nodeId);
    if (count <= 0) return [] as string[];
    return entity.childIds.slice(0, Math.min(count, entity.childIds.length));
  };

  return {
    ensureInitialChildren,
    scheduleAutoLoad,
    getVisibleChildIds: (nodeId: string) => {
      if (!options.isNodeExpanded(nodeId)) return [];
      return sliceChildren(nodeId);
    },
    getRenderableChildIds: (nodeId: string) => sliceChildren(nodeId),
  };
}

type MoveSelectionOptions = {
  visibleRows: Accessor<VisibleRow[]>;
  rowIndexMap: Accessor<Map<string, number>>;
  selectedId: Accessor<string | null>;
  selectNode: (nodeId: string | null) => void;
};

function createMoveSelectionAction(options: MoveSelectionOptions) {
  return (delta: number) => {
    const list = options.visibleRows();
    if (!list.length) return;
    const current = options.selectedId();
    const index = current ? (options.rowIndexMap().get(current) ?? -1) : -1;
    const baseIndex = index === -1 ? 0 : index;
    const nextIndex = Math.max(0, Math.min(list.length - 1, baseIndex + delta));
    options.selectNode(list[nextIndex]?.id ?? null);
  };
}

type FocusFirstChildOptions = {
  selectedRow: Accessor<VisibleRow | null>;
  entityMap: Accessor<Map<string, NodeEntity>>;
  expandNode: (nodeId: string | null) => void;
  ensureInitialChildren: (nodeId: string) => void;
  selectNode: (nodeId: string | null) => void;
};

function createFocusFirstChildAction(options: FocusFirstChildOptions) {
  return () => {
    const row = options.selectedRow();
    if (!row) return;
    const entity = options.entityMap().get(row.id);
    const firstChildId = entity?.childIds[0];
    if (!entity?.hasChildren || !firstChildId) return;
    batch(() => {
      options.expandNode(row.id);
      options.ensureInitialChildren(row.id);
      options.selectNode(firstChildId);
    });
  };
}

type CollapseCurrentOrParentOptions = {
  selectedRow: Accessor<VisibleRow | null>;
  entityMap: Accessor<Map<string, NodeEntity>>;
  collapseNode: (nodeId: string | null) => void;
  selectNode: (nodeId: string | null) => void;
  isNodeExpanded: (nodeId: string | null) => boolean;
};

function createCollapseCurrentOrParentAction(options: CollapseCurrentOrParentOptions) {
  return () => {
    const row = options.selectedRow();
    if (!row) return;
    const entity = options.entityMap().get(row.id);
    const expanded = entity?.hasChildren && options.isNodeExpanded(row.id);
    if (expanded) {
      options.collapseNode(row.id);
      return;
    }
    if (row?.parentId) {
      options.collapseNode(row.parentId);
      options.selectNode(row.parentId);
    }
  };
}

type ActivateSelectionOptions = {
  selectedRow: Accessor<VisibleRow | null>;
  entityMap: Accessor<Map<string, NodeEntity>>;
  collapseNode: (nodeId: string | null) => void;
  expandNode: (nodeId: string | null) => void;
  isNodeExpanded: (nodeId: string | null) => boolean;
};

function createActivateSelectionAction(options: ActivateSelectionOptions) {
  return () => {
    const row = options.selectedRow();
    if (!row) return;
    const entity = options.entityMap().get(row.id);
    if (!entity?.hasChildren) return;
    if (options.isNodeExpanded(row.id)) {
      options.collapseNode(row.id);
      return;
    }
    options.expandNode(row.id);
  };
}
