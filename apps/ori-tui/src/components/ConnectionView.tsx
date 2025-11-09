import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Logger } from "pino";
import type { Configuration } from "@src/lib/configuration";
import type { Node, OriClient } from "@src/lib/configurationsClient";
import { loadFullGraph, type GraphSnapshot } from "@src/lib/graph";

export interface ConnectionViewProps {
    configuration: Configuration;
    client: OriClient;
    logger: Logger;
    onBack: () => void;
}

interface TreeRow {
    node: Node;
    depth: number;
}

export function ConnectionView(props: ConnectionViewProps) {
    const [graph, setGraph] = createSignal<GraphSnapshot | null>(null);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);

    const rows = createMemo<TreeRow[]>(() => {
        const snapshot = graph();
        if (!snapshot) {
            return [];
        }
        const ordered: TreeRow[] = [];
        const visited = new Set<string>();
        const visit = (nodeId: string, depth: number) => {
            if (visited.has(nodeId)) {
                return;
            }
            visited.add(nodeId);
            const node = snapshot.nodes.get(nodeId);
            if (!node) {
                return;
            }
            ordered.push({ node, depth });
            for (const childId of gatherChildIds(node)) {
                visit(childId, depth + 1);
            }
        };
        for (const rootId of snapshot.rootIds) {
            visit(rootId, 0);
        }
        return ordered;
    });

    useKeyboard((evt) => {
        if (
            evt.name === "escape" ||
            evt.name === "backspace" ||
            (evt.ctrl && evt.name === "[")
        ) {
            evt.preventDefault?.();
            props.onBack?.();
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
                            const description = describeNode(row.node);
                            const badges = nodeBadges(row.node);
                            return (
                                <box flexDirection="row" paddingLeft={row.depth * 2}>
                                    <text>{iconForNode(row.node)} </text>
                                    <text attributes={TextAttributes.BOLD}>{row.node.name}</text>
                                    {description && (
                                        <text attributes={TextAttributes.DIM}>
                                            {" "}
                                            {description}
                                        </text>
                                    )}
                                    {badges && (
                                        <text fg="cyan">
                                            {" "}
                                            {badges}
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
            <text attributes={TextAttributes.DIM}>Press Esc to go back</text>
        </box>
    );
}

function gatherChildIds(node: Node): string[] {
    const children: string[] = [];
    for (const edge of Object.values(node.edges ?? {})) {
        children.push(...edge.items);
    }
    return children;
}

function iconForNode(node: Node): string {
    switch (node.type) {
        case "database":
            return "[DB]";
        case "table":
            return "[TB]";
        case "view":
            return "[VW]";
        case "column":
            return "[CL]";
        case "constraint":
            return "[CT]";
        default:
            return "[ND]";
    }
}

function describeNode(node: Node): string | undefined {
    switch (node.type) {
        case "database":
            return node.attributes?.database ?? undefined;
        case "table":
        case "view":
            return node.attributes?.table ?? undefined;
        case "column":
            return node.attributes?.dataType ?? undefined;
        case "constraint":
            return node.attributes?.constraintType ?? undefined;
        default:
            return undefined;
    }
}

function nodeBadges(node: Node): string | undefined {
    if (node.type === "column") {
        const badges: string[] = [];
        if (node.attributes?.primaryKeyPosition && node.attributes.primaryKeyPosition > 0) {
            badges.push("PK");
        }
        if (node.attributes?.notNull) {
            badges.push("NOT NULL");
        }
        if (node.attributes?.dataType) {
            badges.push(String(node.attributes.dataType));
        }
        return badges.length > 0 ? badges.join(" • ") : undefined;
    }
    if (node.type === "constraint") {
        return node.attributes?.constraintType ?? undefined;
    }
    return undefined;
}
