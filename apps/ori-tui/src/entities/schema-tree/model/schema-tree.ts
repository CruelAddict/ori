import { batch, createEffect, createMemo, createSignal, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type { GraphSnapshot } from "../api/graph";
import { buildNodeEntityMap, type NodeEntity } from "./node-entity";

export interface TreeRow {
    id: string;
    depth: number;
    entity: NodeEntity;
    isExpanded: boolean;
    parentId?: string;
}

export interface SchemaTreeController {
    rows: Accessor<TreeRow[]>;
    selectedId: Accessor<string | null>;
    selectedRow: Accessor<TreeRow | null>;
    expandNode: (nodeId: string | null) => void;
    collapseNode: (nodeId: string | null) => void;
    moveSelection: (delta: number) => void;
    focusFirstChild: () => void;
    collapseCurrentOrParent: () => void;
    selectNode: (nodeId: string | null) => void;
    getRowById: (nodeId: string | null) => TreeRow | null;
}

export function useSchemaTree(snapshot: Accessor<GraphSnapshot | null>): SchemaTreeController {
    const entityMap = createMemo(() => {
        const snap = snapshot();
        if (!snap) {
            return new Map<string, NodeEntity>();
        }
        return buildNodeEntityMap(snap.nodes);
    });

    const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(new Set());
    const [selectedId, setSelectedId] = createSignal<string | null>(null);
    const [rows, setRows] = createSignal<TreeRow[]>([]);

    createEffect(() => {
        const snap = snapshot();
        if (!snap) {
            setRows([]);
            setExpandedNodes(new Set<string>());
            setSelectedId(null);
            return;
        }
        const map = entityMap();
        const preservedExpanded = new Set<string>();
        const previous = untrack(() => expandedNodes());
        for (const id of previous) {
            if (map.has(id)) {
                preservedExpanded.add(id);
            }
        }
        setExpandedNodes(preservedExpanded);
        setRows(buildRowsForSnapshot(snap, map, preservedExpanded));
    });

    const rowIndexMap = createMemo(() => {
        const list = rows();
        const map = new Map<string, number>();
        for (let index = 0; index < list.length; index += 1) {
            map.set(list[index]!.id, index);
        }
        return map;
    });


    const selectedRow = createMemo(() => {
        const currentId = selectedId();
        if (!currentId) return null;
        const index = rowIndexMap().get(currentId);
        if (index === undefined) return null;
        return rows()[index] ?? null;
    });

    const getRowById = (nodeId: string | null) => {
        if (!nodeId) return null;
        const index = rowIndexMap().get(nodeId);
        if (index === undefined) return null;
        return rows()[index] ?? null;
    };


    // llm generated, supposedly does its job
    const expandNode = (nodeId: string | null) => {
        if (!nodeId) return;
        const map = entityMap();
        const entity = map.get(nodeId);
        if (!entity || !entity.hasChildren) {
            return;
        }
        const currentExpanded = expandedNodes();
        if (currentExpanded.has(nodeId)) {
            return;
        }
        const nextExpanded = new Set(currentExpanded);
        nextExpanded.add(nodeId);

        const currentRows = rows();
        const index = rowIndexMap().get(nodeId);
        if (index === undefined) {
            const snap = snapshot();
            if (!snap) {
                return;
            }
            batch(() => {
                setExpandedNodes(nextExpanded);
                setRows(buildRowsForSnapshot(snap, map, nextExpanded));
            });
            return;
        }

        const parentRow = currentRows[index]!;
        const descendants = buildDescendantRows(entity, parentRow.depth + 1, map, nextExpanded);
        const updatedRows = currentRows.slice();
        updatedRows[index] = { ...parentRow, isExpanded: true };
        if (descendants.length) {
            updatedRows.splice(index + 1, 0, ...descendants);
        }

        batch(() => {
            setExpandedNodes(nextExpanded);
            setRows(updatedRows);
        });
    };

    // llm generated, supposedly does its job
    const collapseNode = (nodeId: string | null) => {
        if (!nodeId) return;
        const currentRows = rows();
        const index = rowIndexMap().get(nodeId);
        if (index === undefined) {
            return;
        }
        const row = currentRows[index]!;
        if (!row.entity.hasChildren) {
            return;
        }
        const removal = collectDescendantSegment(currentRows, index);
        if (removal.count === 0 && !row.isExpanded) {
            return;
        }

        const updatedRows = currentRows.slice();
        updatedRows[index] = { ...row, isExpanded: false };
        if (removal.count > 0) {
            updatedRows.splice(index + 1, removal.count);
        }

        const nextExpanded = new Set(expandedNodes());
        nextExpanded.delete(nodeId);
        for (const id of removal.ids) {
            nextExpanded.delete(id);
        }

        batch(() => {
            setExpandedNodes(nextExpanded);
            setRows(updatedRows);
        });
    };

    const selectNode = (nodeId: string | null) => {
        setSelectedId(nodeId);
    };

    const moveSelection = (delta: number) => {
        const list = rows();
        if (!list.length) {
            return;
        }
        const currentId = selectedId();
        const indexMap = rowIndexMap();
        const currentIndex = currentId ? indexMap.get(currentId) ?? -1 : -1;
        const baseIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = Math.max(0, Math.min(list.length - 1, baseIndex + delta));
        selectNode(list[nextIndex]?.id ?? null);
    };

    const focusFirstChild = () => {
        const row = selectedRow();
        if (!row) return;
        const firstChildId = row.entity.childIds[0];
        if (!firstChildId) {
            return;
        }
        expandNode(row.id);
        selectNode(firstChildId);
    };

    const collapseCurrentOrParent = () => {
        const row = selectedRow();
        if (!row) return;
        const isExpanded = row.entity.hasChildren && expandedNodes().has(row.id);
        if (isExpanded) {
            collapseNode(row.id);
            return;
        }
        if (row.parentId) {
            collapseNode(row.parentId);
            selectNode(row.parentId);
        }
    };

    createEffect(() => {
        const snap = snapshot();
        if (!snap) {
            setExpandedNodes(new Set<string>());
            setSelectedId(null);
            return;
        }
        if (!snap.rootIds.length) {
            setSelectedId(null);
            return;
        }
        const current = selectedId();
        if (!current) {
            setSelectedId(snap.rootIds[0]);
            return;
        }
        if (!rowIndexMap().has(current)) {
            setSelectedId(snap.rootIds[0]);
        }
    });

    createEffect(() => {
        const list = rows();
        if (!list.length) {
            setSelectedId(null);
        }
    });

    return {
        rows,
        selectedId,
        selectedRow,
        expandNode,
        collapseNode,
        moveSelection,
        focusFirstChild,
        collapseCurrentOrParent,
        selectNode,
        getRowById,
    };
}

function buildRowsForSnapshot(
    snapshot: GraphSnapshot,
    entities: Map<string, NodeEntity>,
    expanded: Set<string>,
): TreeRow[] {
    const ordered: TreeRow[] = [];
    for (const rootId of snapshot.rootIds) {
        const entity = entities.get(rootId);
        if (!entity) continue;
        const isExpanded = entity.hasChildren && expanded.has(entity.id);
        ordered.push({ id: entity.id, depth: 0, entity, isExpanded });
        if (isExpanded) {
            ordered.push(...buildDescendantRows(entity, 1, entities, expanded));
        }
    }
    return ordered;
}

function buildDescendantRows(
    parent: NodeEntity,
    depth: number,
    entities: Map<string, NodeEntity>,
    expanded: Set<string>,
): TreeRow[] {
    const list: TreeRow[] = [];
    for (const childId of parent.childIds) {
        const entity = entities.get(childId);
        if (!entity) continue;
        const isExpanded = entity.hasChildren && expanded.has(entity.id);
        const row: TreeRow = { id: entity.id, depth, entity, isExpanded, parentId: parent.id };
        list.push(row);
        if (isExpanded) {
            list.push(...buildDescendantRows(entity, depth + 1, entities, expanded));
        }
    }
    return list;
}

function collectDescendantSegment(list: TreeRow[], parentIndex: number) {
    const parent = list[parentIndex];
    if (!parent) {
        return { count: 0, ids: [] as string[] };
    }
    const parentDepth = parent.depth;
    const ids: string[] = [];
    let cursor = parentIndex + 1;
    while (cursor < list.length && list[cursor]!.depth > parentDepth) {
        ids.push(list[cursor]!.id);
        cursor += 1;
    }
    return { count: cursor - (parentIndex + 1), ids };
}
