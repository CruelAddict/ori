import { For, Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { useTreeScrollRegistration } from "./tree-scrollbox.tsx";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { useTheme } from "@app/providers/theme";

interface TreeNodeProps {
    nodeId: string;
    depth: number;
    isFocused: Accessor<boolean>;
    pane: TreePaneViewModel;
}

export function TreeNode(props: TreeNodeProps) {
    const registerRowNode = useTreeScrollRegistration();
    const { theme } = useTheme();
    const palette = theme;

    const entity = createMemo(() => props.pane.controller.getEntity(props.nodeId));
    const childIds = createMemo(() => props.pane.controller.getRenderableChildIds(props.nodeId));
    const rowId = () => props.nodeId;
    const isExpanded = () => props.pane.controller.isExpanded(props.nodeId);
    const isSelected = () => props.pane.controller.selectedId() === rowId();
    const [childrenMounted, setChildrenMounted] = createSignal(false);

    createEffect(() => {
        if (isExpanded()) setChildrenMounted(true);
    });

    const fg = () => (isSelected() && props.isFocused() ? palette().background : palette().text);
    const bg = () => (isSelected() && props.isFocused() ? palette().primary : undefined);
    const attrs = () => (isSelected() ? TextAttributes.BOLD : TextAttributes.NONE);

    const toggleGlyph = () => {
        const details = entity();
        if (!details?.hasChildren) return "   ";
        return isExpanded() ? "[-]" : "[+]";
    };

    return (
        <Show when={entity()}>
            {(detailsAccessor: Accessor<ReturnType<typeof entity>>) => {
                const details = () => detailsAccessor()!;
                return (
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
                            <text fg={fg()} attributes={attrs()} wrapMode="none" bg={bg()} >
                                {isSelected() ? "> " : "  "}
                                {toggleGlyph()} {details().icon} {details().label}
                            </text>
                            {details().description && (
                                <text attributes={TextAttributes.DIM} fg={palette().textMuted} wrapMode="none">
                                    {" "}
                                    {details().description}
                                </text>
                            )}
                            {details().badges && (
                                <text fg={palette().accent} wrapMode="none">
                                    {" "}
                                    {details().badges}
                                </text>
                            )}
                        </box>
                        <Show when={childrenMounted()}>
                            <box flexDirection="column" visible={isExpanded()}>
                                <For each={childIds()}>
                                    {(childId) => (
                                        <TreeNode
                                            nodeId={childId}
                                            depth={props.depth + 1}
                                            isFocused={props.isFocused}
                                            pane={props.pane}
                                        />
                                    )}
                                </For>
                            </box>
                        </Show>
                    </>
                );
            }}
        </Show>
    );
}

function rowElementId(rowId: string) {
    const ROW_ID_PREFIX = "tree-row-";
    return `${ROW_ID_PREFIX}${rowId}`;
}
