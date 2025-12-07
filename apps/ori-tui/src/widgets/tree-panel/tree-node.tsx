import { useTheme } from "@app/providers/theme";
import type { BoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import type { NodeEntity } from "@src/entities/schema-tree/model/node-entity";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { type RowDescriptor, useTreeScrollRegistration } from "./tree-scrollbox.tsx";

type TreeNodeProps = {
    nodeId: string;
    depth: number;
    isFocused: Accessor<boolean>;
    pane: TreePaneViewModel;
    isRowSelected: (key: string) => boolean;
};

export function TreeNode(props: TreeNodeProps) {
    const registerRowNode = useTreeScrollRegistration();
    const { theme } = useTheme();
    const palette = theme;

    const entity = createMemo(() => props.pane.controller.getEntity(props.nodeId));
    const childIds = createMemo(() => props.pane.controller.getRenderableChildIds(props.nodeId));
    const rowId = () => props.nodeId;
    const isExpanded = () => props.pane.controller.isExpanded(props.nodeId);
    const isSelected = () => props.isRowSelected(props.nodeId);
    const [childrenMounted, setChildrenMounted] = createSignal(false);

    createEffect(() => {
        if (isExpanded()) setChildrenMounted(true);
    });

    const fg = () => (isSelected() && props.isFocused() ? palette().background : palette().text);
    const bg = () => (isSelected() && props.isFocused() ? palette().primary : undefined);

    const toggleGlyph = () => {
        const details = entity();
        if (!details?.hasChildren) return "   ";
        return isExpanded() ? "[-]" : "[+]";
    };

    return (
        <Show
            when={entity()}
            keyed
        >
            {(details: NodeEntity) => (
                <>
                    <box
                        id={rowElementId(rowId())}
                        flexDirection="row"
                        paddingLeft={props.depth * 2}
                        minWidth={"100%"}
                        flexShrink={0}
                        ref={(node: BoxRenderable | undefined) => registerRowNode(rowId(), node)}
                        backgroundColor={bg()}
                    >
                        <text
                            fg={fg()}
                            wrapMode="none"
                            bg={bg()}
                            selectable={false}
                        >
                            {isSelected() ? "> " : "  "}
                            {toggleGlyph()} {details.icon} {details.label}
                        </text>
                        {details.description && (
                            <text
                                attributes={TextAttributes.DIM}
                                fg={palette().textMuted}
                                wrapMode="none"
                                selectable={false}
                            >
                                {" "}
                                {details.description}
                            </text>
                        )}
                        {details.badges && (
                            <text
                                fg={palette().accent}
                                wrapMode="none"
                                selectable={false}
                            >
                                {" "}
                                {details.badges}
                            </text>
                        )}
                    </box>
                    <Show when={childrenMounted()}>
                        <box
                            flexDirection="column"
                            visible={isExpanded()}
                        >
                            <For each={childIds()}>
                                {(childId) => (
                                    <TreeNode
                                        nodeId={childId}
                                        depth={props.depth + 1}
                                        isFocused={props.isFocused}
                                        pane={props.pane}
                                        isRowSelected={props.isRowSelected}
                                    />
                                )}
                            </For>
                        </box>
                    </Show>
                </>
            )}
        </Show>
    );
}

function rowElementId(rowId: string) {
    const ROW_ID_PREFIX = "tree-row-";
    return `${ROW_ID_PREFIX}${rowId}`;
}

type TreeNodeMetricsOptions = {
    getEntity: (
        id: string,
    ) => { label: string; icon?: string; description?: string; badges?: string; hasChildren: boolean } | undefined;
    isExpanded: (id: string) => boolean;
};

export function createTreeNodeMetrics(options: TreeNodeMetricsOptions) {
    const { getEntity, isExpanded } = options;
    const cache = new Map<string, number>();

    return (row: RowDescriptor): number => {
        const expanded = isExpanded(row.id) ? 1 : 0;
        const key = `${row.id}@${row.depth}:${expanded}`;

        const cached = cache.get(key);
        if (cached !== undefined) return cached;

        const entity = getEntity(row.id);
        const hasChildren = Boolean(entity?.hasChildren);
        let glyph = "   ";
        if (hasChildren) {
            glyph = expanded ? "[-]" : "[+]";
        }
        const indicator = "> ";
        const icon = entity?.icon ? `${entity.icon}` : "";
        let width = row.depth * 2;
        const base = `${indicator}${glyph} ${icon} ${entity?.label ?? ""}`;
        width += base.length;
        if (entity?.description) width += 1 + entity.description.length;
        if (entity?.badges) width += 1 + entity.badges.length;

        cache.set(key, width);
        return width;
    };
}
