import { createMemo, createSignal, createEffect } from "solid-js";
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

    const rows = createMemo<TreeRow[]>(() => {
        const snap = snapshot();
        if (!snap) {
            return [];
        }
        const expanded = expandedNodes();
        const map = entityMap();
        const ordered: TreeRow[] = [];
        const visited = new Set<string>();

        const visit = (nodeId: string, depth: number, parentId?: string) => {
            if (visited.has(nodeId)) {
                return;
            }
            const entity = map.get(nodeId);
            if (!entity) {
                return;
            }
            visited.add(nodeId);
            const isExpanded = entity.hasChildren && expanded.has(nodeId);
            ordered.push({ id: entity.id, depth, entity, isExpanded, parentId });
            if (!entity.hasChildren || !isExpanded) {
                return;
            }
            for (const childId of entity.childIds) {
                visit(childId, depth + 1, entity.id);
            }
        };

        for (const rootId of snap.rootIds) {
            visit(rootId, 0);
        }

        return ordered;
    });

    const selectedRow = createMemo(() => {
        const currentId = selectedId();
        if (!currentId) return null;
        return rows().find((row) => row.id === currentId) ?? null;
    });

    const expandNode = (nodeId: string | null) => {
        if (!nodeId) return;
        setExpandedNodes((prev) => {
            if (prev.has(nodeId)) {
                return prev;
            }
            const next = new Set(prev);
            next.add(nodeId);
            return next;
        });
    };

    const collapseNode = (nodeId: string | null) => {
        if (!nodeId) return;
        setExpandedNodes((prev) => {
            if (!prev.has(nodeId)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(nodeId);
            return next;
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
        const current = selectedRow();
        const currentIndex = current ? list.findIndex((row) => row.id === current.id) : -1;
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
        if (!rows().some((row) => row.id === current)) {
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
    };
}
