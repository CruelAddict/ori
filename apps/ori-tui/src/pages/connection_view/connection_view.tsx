import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";
import { KeyScope } from "@src/core/services/keyScopes";
import { useConnectionView } from "@src/features/connection/view/use_connection_view";
import { TreePanel } from "@src/widgets/tree_panel/tree_panel";
import { EditorPanel } from "@src/widgets/editor_panel/editor_panel";
import { ResultsPanel } from "@src/widgets/results_panel/results_panel";

export interface ConnectionViewPageProps {
    configurationName: string;
    onBack: () => void;
}

export function ConnectionViewPage(props: ConnectionViewPageProps) {
    const vm = useConnectionView({
        configurationName: () => props.configurationName,
        onBack: props.onBack,
    });

    return (
        <KeyScope id="connection-view" bindings={vm.screenKeyBindings}>
            <box flexDirection="column" flexGrow={1} padding={1}>
                <text attributes={TextAttributes.BOLD}>Connection</text>
                <text attributes={TextAttributes.DIM}>{vm.title()}</text>
                <box height={1} />

                <box flexDirection="row" flexGrow={1}>
                    <TreePanel viewModel={vm.treePane} />

                    <box flexDirection="column" flexGrow={1} marginLeft={vm.treePane.visible() ? 1 : 0}>
                        <EditorPanel viewModel={vm.editorPane} configurationName={props.configurationName} />
                        <Show when={vm.resultsPane.visible()}>
                            <>
                                <box height={1} />
                                <ResultsPanel viewModel={vm.resultsPane} />
                            </>
                        </Show>
                    </box>
                </box>

                <box height={1} />
                <text attributes={TextAttributes.DIM}>{vm.helpText}</text>
            </box>
        </KeyScope>
    );
}
