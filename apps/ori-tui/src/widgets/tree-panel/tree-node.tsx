import { useTheme } from "@app/providers/theme";
import type { BoxRenderable } from "@opentui/core";
import { TextAttributes } from "@opentui/core";
import type { NodeEntity } from "@src/entities/schema-tree/model/node-entity";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { type Accessor, createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { type TreeRowSegment } from "./tree-row-renderable.ts";
import "./tree-row-renderable.ts";
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
    const bg = () => (isSelected() && props.isFocused() ? palette().primary : palette().background);

    const rowParts = createMemo(() => buildRowTextParts(entity(), isExpanded(), isSelected()));
    const rowSegments = createMemo(() =>
        buildRowSegments(rowParts(), {
            baseFg: fg(),
            baseBg: bg(),
            accent: palette().accent,
            muted: palette().textMuted,
        }),
    );
    const rowWidth = createMemo(() => calculateRowTextWidth(rowParts()));

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
                        <tree_row
                            segments={rowSegments()}
                            width={rowWidth()}
                            fg={fg()}
                            bg={bg()}
                            selectable={false}
                        />
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

type TreeRowEntityLike = {
    label?: string;
    icon?: string;
    description?: string;
    badges?: string;
    hasChildren?: boolean;
};

type RowTextParts = {
    indicator: string;
    main: string;
    description?: string;
    badges?: string;
};

function buildRowTextParts(details: TreeRowEntityLike | undefined, expanded: boolean, selected: boolean): RowTextParts {
    const hasChildren = Boolean(details?.hasChildren);
    const glyph = hasChildren ? (expanded ? "[-]" : "[+]") : "   ";
    const icon = details?.icon ? `${details.icon}` : "";
    const label = details?.label ?? "";
    const indicator = selected ? "> " : "  ";
    const main = `${glyph} ${icon} ${label}`;
    return {
        indicator,
        main,
        description: details?.description,
        badges: details?.badges,
    };
}

function calculateRowTextWidth(parts: RowTextParts): number {
    let width = parts.indicator.length + parts.main.length;
    if (parts.description) width += 1 + parts.description.length;
    if (parts.badges) width += 1 + parts.badges.length;
    return width;
}

function calculateRowWidth(parts: RowTextParts, depth: number): number {
    return depth * 2 + calculateRowTextWidth(parts);
}

function buildRowSegments(
    parts: RowTextParts,
    colors: { baseFg: string; baseBg?: string; muted: string; accent: string },
): TreeRowSegment[] {
    const segments: TreeRowSegment[] = [
        { text: `${parts.indicator}${parts.main}`, fg: colors.baseFg, bg: colors.baseBg },
    ];
    if (parts.description) {
        segments.push({
            text: ` ${parts.description}`,
            fg: colors.muted,
            bg: colors.baseBg,
            attributes: TextAttributes.DIM,
        });
    }
    if (parts.badges) {
        segments.push({
            text: ` ${parts.badges}`,
            fg: colors.accent,
            bg: colors.baseBg,
        });
    }
    return segments;
}

type TreeNodeMetricsOptions = {
    getEntity: (id: string) => TreeRowEntityLike | undefined;
    isExpanded: (id: string) => boolean;
};

export function createTreeNodeMetrics(options: TreeNodeMetricsOptions) {
    const { getEntity, isExpanded } = options;
    const cache = new Map<string, number>();

    return (row: RowDescriptor): number => {
        const expanded = isExpanded(row.id);
        const key = `${row.id}@${row.depth}:${expanded ? 1 : 0}`;

        const cached = cache.get(key);
        if (cached !== undefined) return cached;

        const entity = getEntity(row.id);
        const parts = buildRowTextParts(entity, expanded, false);
        const width = calculateRowWidth(parts, row.depth);

        cache.set(key, width);
        return width;
    };
}
