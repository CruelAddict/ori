import { Show } from "solid-js";
import { KeyScope } from "@src/core/services/keyScopes";
import type { TreePaneViewModel } from "@src/features/tree-pane/use_tree_pane";
import { SchemaTreePane } from "@src/ui/components/SchemaTreePane";

export interface TreePanelProps {
    viewModel: TreePaneViewModel;
}

export function TreePanel(props: TreePanelProps) {
    const pane = props.viewModel;

    return (
        <Show when={pane.visible()}>
            <KeyScope id={pane.scope.id} bindings={pane.scope.bindings} enabled={pane.scope.enabled}>
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
