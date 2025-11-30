import type { Accessor } from "solid-js";
import { batch, createEffect, createMemo, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { GraphSnapshot } from "../api/graph";
import { buildNodeEntityMap, type NodeEntity } from "./node-entity";

const CHILD_BATCH_SIZE = 10;

export type VisibleRow = {
    id: string;
    parentId?: string;
    depth: number;
};

export type SchemaTreeController = {
    rootIds: Accessor<string[]>;
    visibleRows: Accessor<VisibleRow[]>;
    selectedId: Accessor<string | null>;
    selectedRow: Accessor<VisibleRow | null>;
    expandNode: (nodeId: string | null) => void;
    collapseNode: (nodeId: string | null) => void;
    moveSelection: (delta: number) => void;
    focusFirstChild: () => void;
    collapseCurrentOrParent: () => void;
    selectNode: (nodeId: string | null) => void;
    isExpanded: (nodeId: string | null) => boolean;
    getEntity: (nodeId: string | null) => NodeEntity | undefined;
    getVisibleChildIds: (nodeId: string) => string[];
    // Returns currently loaded children (based on batching), independent of expanded state.
    getRenderableChildIds: (nodeId: string) => string[];
    activateSelection: () => void;
};

export function useSchemaTree(snapshot: Accessor<GraphSnapshot | null>): SchemaTreeController {
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

    // Async auto-load queue
    let autoLoadQueue = new Set<string>();
    let autoLoadHandle: ReturnType<typeof setTimeout> | null = null;

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

    // Prune stale entries when snapshot changes
    createEffect(() => {
        const map = entityMap();
        setExpandedNodes(
            produce((state) => {
                for (const id of Object.keys(state)) {
                    if (!map.has(id)) delete state[id];
                }
            }),
        );
        setVisibleChildCounts(
            produce((counts) => {
                for (const id of Object.keys(counts)) {
                    if (!map.has(id)) delete counts[id];
                }
            }),
        );
    });

    // Maintain a valid selection when graph/rows change
    createEffect(() => {
        const snap = snapshot();
        if (!snap) {
            batch(() => {
                setSelectedId(null);
            });
            return;
        }
        const rows = visibleRows();
        if (!rows.length) {
            setSelectedId(null);
            return;
        }
        const current = selectedId();
        if (!current) {
            setSelectedId(rows[0]?.id);
            return;
        }
        const rowIndex = rowIndexMap().get(current);
        if (rowIndex !== undefined) {
            return;
        }
        if (entityMap().has(current)) {
            // Node still exists (maybe temporarily hidden), so keep selection as-is.
            return;
        }
        setSelectedId(rows[0]?.id);
    });

    const ensureInitialChildren = (nodeId: string) => {
        const entity = entityMap().get(nodeId);
        if (!entity?.hasChildren) return;
        const limit = Math.min(entity.childIds.length, CHILD_BATCH_SIZE);
        setVisibleChildCounts(nodeId, (currentValue) => {
            const current = currentValue ?? 0;
            return current >= limit ? current : limit;
        });
    };

    const scheduleAutoLoad = (nodeId: string) => {
        const entity = entityMap().get(nodeId);
        if (!entity?.hasChildren) return;
        const current = getVisibleCount(nodeId);
        if (current >= entity.childIds.length) return;
        autoLoadQueue.add(nodeId);
        if (autoLoadHandle === null) {
            autoLoadHandle = setTimeout(runAutoLoadCycle, 0);
        }
    };

    const runAutoLoadCycle = () => {
        autoLoadHandle = null;
        if (autoLoadQueue.size === 0) return;
        const entities = entityMap();
        const pending = new Set<string>();
        for (const nodeId of autoLoadQueue) {
            if (!isNodeExpanded(nodeId)) continue; // collapsed nodes drop out
            const entity = entities.get(nodeId);
            if (!entity?.childIds.length) continue;
            const baseline = getVisibleCount(nodeId);
            if (baseline >= entity.childIds.length) continue;
            const target = Math.min(entity.childIds.length, baseline + CHILD_BATCH_SIZE);
            if (target === baseline) continue;
            setVisibleChildCounts(nodeId, target);
            if (target < entity.childIds.length) pending.add(nodeId);
        }
        autoLoadQueue = pending;
        if (autoLoadQueue.size) {
            autoLoadHandle = setTimeout(runAutoLoadCycle, 0);
        }
    };

    const expandNode = (nodeId: string | null) => {
        if (!nodeId) return;
        const entity = entityMap().get(nodeId);
        if (!entity?.hasChildren) return;
        if (isNodeExpanded(nodeId)) return;
        setExpandedNodes(nodeId, true);
        ensureInitialChildren(nodeId);
        scheduleAutoLoad(nodeId);
    };

    const collapseNode = (nodeId: string | null) => {
        if (!nodeId) return;
        if (!isNodeExpanded(nodeId)) return;
        setExpandedNodes(
            produce((state) => {
                delete state[nodeId];
            }),
        );
        // No need to change visibleChildCounts; we keep mounted counts for fast re-open
    };

    const getVisibleChildIds = (nodeId: string) => {
        if (!isNodeExpanded(nodeId)) return [];
        const entity = entityMap().get(nodeId);
        if (!entity) return [];
        const count = getVisibleCount(nodeId);
        if (count <= 0) return [];
        return entity.childIds.slice(0, Math.min(count, entity.childIds.length));
    };

    const getRenderableChildIds = (nodeId: string) => {
        const entity = entityMap().get(nodeId);
        if (!entity) return [];
        const count = getVisibleCount(nodeId);
        if (count <= 0) return [];
        return entity.childIds.slice(0, Math.min(count, entity.childIds.length));
    };

    const selectNode = (nodeId: string | null) => setSelectedId(nodeId);

    const moveSelection = (delta: number) => {
        const list = visibleRows();
        if (!list.length) return;
        const current = selectedId();
        const index = current ? (rowIndexMap().get(current) ?? -1) : -1;
        const baseIndex = index === -1 ? 0 : index;
        const nextIndex = Math.max(0, Math.min(list.length - 1, baseIndex + delta));
        selectNode(list[nextIndex]?.id ?? null);
    };

    const focusFirstChild = () => {
        const row = selectedRow();
        if (!row) return;
        const entity = entityMap().get(row.id);
        const firstChildId = entity?.childIds[0];
        if (!entity?.hasChildren || !firstChildId) return;
        batch(() => {
            expandNode(row.id);
            ensureInitialChildren(row.id);
            selectNode(firstChildId);
        });
    };

    const collapseCurrentOrParent = () => {
        const row = selectedRow();
        if (!row) return;
        const entity = entityMap().get(row.id);
        const expanded = entity?.hasChildren && isNodeExpanded(row.id);
        if (expanded) {
            collapseNode(row.id);
            return;
        }
        if (row.parentId) {
            collapseNode(row.parentId);
            selectNode(row.parentId);
        }
    };

    const activateSelection = () => {
        const row = selectedRow();
        if (!row) return;
        const entity = entityMap().get(row.id);
        if (!entity?.hasChildren) return;
        if (isNodeExpanded(row.id)) collapseNode(row.id);
        else expandNode(row.id);
    };

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
        isExpanded: (nodeId) => isNodeExpanded(nodeId),
        getEntity: (nodeId) => (nodeId ? entityMap().get(nodeId) : undefined),
        getVisibleChildIds,
        getRenderableChildIds,
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
        const childId = parent.childIds[index]!;
        const child = entities.get(childId);
        if (!child) continue;
        list.push({ id: child.id, depth, parentId });
        if (child.hasChildren && isExpanded(child.id)) {
            appendVisibleChildren(list, child.id, depth + 1, entities, isExpanded, getVisibleCount);
        }
    }
}
