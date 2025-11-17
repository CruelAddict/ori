import { Show } from "solid-js";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { TreePaneViewModel } from "@src/features/tree-pane/use-tree-pane";
import { SchemaTreePane } from "@src/ui/components/schema-tree-pane";

const TREE_SCOPE_ID = "connection-view.tree";

export interface TreePanelProps {
    viewModel: TreePaneViewModel;
}

export function TreePanel(props: TreePanelProps) {
    const pane = props.viewModel;

    const moveSelection = (delta: number) => {
        pane.controller.moveSelection(delta);
    };

    const bindings: KeyBinding[] = [
        { pattern: "down", handler: () => moveSelection(1), preventDefault: true },
        { pattern: "j", handler: () => moveSelection(1), preventDefault: true },
        { pattern: "up", handler: () => moveSelection(-1), preventDefault: true },
        { pattern: "k", handler: () => moveSelection(-1), preventDefault: true },
        { pattern: "right", handler: () => pane.controller.focusFirstChild(), preventDefault: true },
        { pattern: "l", handler: () => pane.controller.focusFirstChild(), preventDefault: true },
        { pattern: "left", handler: () => pane.controller.collapseCurrentOrParent(), preventDefault: true },
        { pattern: "h", handler: () => pane.controller.collapseCurrentOrParent(), preventDefault: true },
    ];

    const enabled = () => pane.visible() && pane.isFocused();

    return (
        <Show when={pane.visible()}>
            <KeyScope id={TREE_SCOPE_ID} bindings={bindings} enabled={enabled}>
                <SchemaTreePane
                    controller={pane.controller}
                    loading={pane.loading}
                    error={pane.error}
                    focused={pane.isFocused()}
                />
            </KeyScope>
        </Show>
    );
}
