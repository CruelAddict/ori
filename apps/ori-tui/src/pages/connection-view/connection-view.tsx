import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import { useConnectionView } from "@src/features/connection/view/use-connection-view";
import { TreePanel } from "@src/widgets/tree-panel/tree-panel";
import { EditorPanel } from "@src/widgets/editor-panel/editor-panel";
import { ResultsPanel } from "@src/widgets/results-panel/results-panel";

export interface ConnectionViewPageProps {
    configurationName: string;
    onBack: () => void;
}

export function ConnectionViewPage(props: ConnectionViewPageProps) {
    const vm = useConnectionView({
        configurationName: () => props.configurationName,
        onBack: props.onBack,
    });

    const screenKeyBindings: KeyBinding[] = [
        {
            pattern: "escape",
            handler: vm.actions.exit,
            preventDefault: true,
        },
        {
            pattern: "backspace",
            handler: vm.actions.exit,
            when: () => !vm.editorPane.isFocused(),
            preventDefault: true,
        },
        {
            pattern: "ctrl+[",
            handler: vm.actions.exit,
            preventDefault: true,
        },
        {
            pattern: "ctrl+e",
            handler: vm.actions.toggleTreeVisible,
            preventDefault: true,
        },
        {
            pattern: "ctrl+r",
            handler: vm.actions.toggleResultsVisible,
            preventDefault: true,
        },
        {
            pattern: "ctrl+shift+r",
            handler: () => {
                void vm.actions.refreshGraph();
            },
            preventDefault: true,
        },
        {
            pattern: "h",
            mode: "leader",
            handler: vm.actions.moveFocusLeft,
            when: () => vm.treePane.visible(),
            preventDefault: true,
        },
        {
            pattern: "l",
            mode: "leader",
            handler: vm.actions.moveFocusRight,
            preventDefault: true,
        },
        {
            pattern: "j",
            mode: "leader",
            handler: vm.actions.moveFocusDown,
            when: () => vm.resultsPane.visible(),
            preventDefault: true,
        },
        {
            pattern: "k",
            mode: "leader",
            handler: vm.actions.moveFocusUp,
            when: () => vm.resultsPane.isFocused(),
            preventDefault: true,
        },
        {
            pattern: "enter",
            mode: "leader",
            handler: () => {
                void vm.actions.executeQuery();
            },
            preventDefault: true,
        },
    ];

    return (
        <KeyScope id="connection-view" bindings={screenKeyBindings}>
            <box flexDirection="column" flexGrow={1} padding={1}>
                <text attributes={TextAttributes.BOLD}>Connection</text>
                <text attributes={TextAttributes.DIM}>{vm.title()}</text>
                <box height={1} />

                <box flexDirection="row" flexGrow={1}>
                    <TreePanel viewModel={vm.treePane} />

                    <box flexDirection="column" flexGrow={1} marginLeft={vm.treePane.visible() ? 1 : 0}>
                        <EditorPanel viewModel={vm.editorPane} />
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
