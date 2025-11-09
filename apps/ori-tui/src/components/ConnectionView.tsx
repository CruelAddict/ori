import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Logger } from "pino";
import type { Configuration } from "@src/lib/configuration";
import type { OriClient } from "@src/lib/configurationsClient";
import { loadFullGraph, type GraphSnapshot } from "@src/lib/graph";
import { buildNodeEntityMap, type NodeEntity } from "@src/components/nodes/entity";

export interface ConnectionViewProps {
    configuration: Configuration;
    client: OriClient;
    logger: Logger;
    onBack: () => void;
}

interface TreeRow {
    id: string;
    depth: number;
    entity: NodeEntity;
    isExpanded: boolean;
    parentId?: string;
}

export function ConnectionView(props: ConnectionViewProps) {
    const [graph, setGraph] = createSignal<GraphSnapshot | null>(null);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);
    const [expandedNodes, setExpandedNodes] = createSignal<Set<string>>(new Set<string>());
    const [selectedId, setSelectedId] = createSignal<string | null>(null);

    const entityMap = createMemo(() => {
        const snapshot = graph();
        if (!snapshot) {
            return new Map<string, NodeEntity>();
        }
        return buildNodeEntityMap(snapshot.nodes);
    });

    const rows = createMemo<TreeRow[]>(() => {
        const snapshot = graph();
        if (!snapshot) {
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
        for (const rootId of snapshot.rootIds) {
            visit(rootId, 0, undefined);
        }
        return ordered;
    });

    const selectedIndex = createMemo(() => {
        const id = selectedId();
        if (!id) {
            return -1;
        }
        return rows().findIndex((row) => row.id === id);
    });

    const selectedRow = createMemo(() => {
        const index = selectedIndex();
        const list = rows();
        if (index < 0 || index >= list.length) {
            return null;
        }
        return list[index];
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
        const currentIndex = selectedIndex();
        const baseIndex = currentIndex === -1 ? 0 : currentIndex;
        const nextIndex = Math.max(0, Math.min(list.length - 1, baseIndex + delta));
        selectNode(list[nextIndex].id);
    };

    const focusFirstChild = () => {
        const row = selectedRow();
        if (!row) {
            return;
        }
        const firstChildId = row.entity.childIds[0];
        if (!firstChildId) {
            return;
        }
        expandNode(row.id);
        selectNode(firstChildId);
    };

    const collapseCurrentOrParent = () => {
        const row = selectedRow();
        if (!row) {
            return;
        }
        const currentIsExpanded = row.entity.hasChildren && expandedNodes().has(row.id);
        if (currentIsExpanded) {
            collapseNode(row.id);
            return;
        }
        if (row.parentId) {
            collapseNode(row.parentId);
            selectNode(row.parentId);
        }
    };

    useKeyboard((evt) => {
        const name = evt.name?.toLowerCase();
        if (!name) {
            return;
        }

        if (
            name === "escape" ||
            name === "backspace" ||
            (evt.ctrl && name === "[")
        ) {
            evt.preventDefault?.();
            props.onBack?.();
            return;
        }

        if (name === "down" || name === "j") {
            evt.preventDefault?.();
            moveSelection(1);
            return;
        }

        if (name === "up" || name === "k") {
            evt.preventDefault?.();
            moveSelection(-1);
            return;
        }

        if (name === "right" || name === "l") {
            evt.preventDefault?.();
            focusFirstChild();
            return;
        }

        if (name === "left" || name === "h") {
            evt.preventDefault?.();
            collapseCurrentOrParent();
        }
    });

    createEffect(() => {
        const snapshot = graph();
        if (!snapshot) {
            setExpandedNodes(new Set<string>());
            selectNode(null);
            return;
        }
        setExpandedNodes(new Set<string>());
        selectNode(snapshot.rootIds[0] ?? null);
    });

    createEffect(() => {
        const list = rows();
        if (!list.length) {
            selectNode(null);
            return;
        }
        const id = selectedId();
        if (!id || !list.some((row) => row.id === id)) {
            selectNode(list[0].id);
        }
    });

    createEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setGraph(null);

        loadFullGraph(props.client, props.configuration.name, props.logger)
            .then((snapshot) => {
                if (!cancelled) {
                    setGraph(snapshot);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    props.logger.error({ err }, "failed to build graph");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        onCleanup(() => {
            cancelled = true;
        });
    });

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Connection</text>
            <text attributes={TextAttributes.DIM}>{props.configuration.name}</text>
            <box height={1} />

            {loading() && <text>Loading schema graph...</text>}
            {!loading() && error() && (
                <text fg="red">Failed to load graph: {error()}</text>
            )}
            {!loading() && !error() && (
                <box flexDirection="column">
                    <For each={rows()}>
                        {(row) => {
                            const isSelected = () => selectedId() === row.id;
                            const toggleGlyph = row.entity.hasChildren
                                ? row.isExpanded
                                    ? "[-]"
                                    : "[+]"
                                : "   ";
                            const fg = () => (isSelected() ? "cyan" : undefined);
                            const attrs = () =>
                                isSelected() ? TextAttributes.BOLD : TextAttributes.NONE;
                            return (
                                <box flexDirection="row" paddingLeft={row.depth * 2}>
                                    <text fg={fg()} attributes={attrs()}>
                                        {isSelected() ? "> " : "  "}
                                        {toggleGlyph} {row.entity.icon} {row.entity.label}
                                    </text>
                                    {row.entity.description && (
                                        <text attributes={TextAttributes.DIM}>
                                            {" "}
                                            {row.entity.description}
                                        </text>
                                    )}
                                    {row.entity.badges && (
                                        <text fg="cyan">
                                            {" "}
                                            {row.entity.badges}
                                        </text>
                                    )}
                                </box>
                            );
                        }}
                    </For>
                    {rows().length === 0 && (
                        <text attributes={TextAttributes.DIM}>
                            Graph is empty. Try refreshing later.
                        </text>
                    )}
                </box>
            )}

            <box height={1} />
            <text attributes={TextAttributes.DIM}>
                Navigate with ↑/↓ or j/k. Use ←/h to collapse, →/l to dive in. Esc returns.
            </text>
        </box>
    );
}
