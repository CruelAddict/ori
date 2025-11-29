import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";
import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import { useConnectionView } from "@src/features/connection/view/use-connection-view";
import { TreePanel } from "@src/widgets/tree-panel/tree-panel";
import { EditorPanel } from "@src/widgets/editor-panel/editor-panel";
import { ResultsPanel } from "@src/widgets/results-panel/results-panel";
import { useTheme } from "@app/providers/theme";

export interface ConnectionViewPageProps {
    configurationName: string;
    onBack: () => void;
}

export function ConnectionViewPage(props: ConnectionViewPageProps) {
    const vm = useConnectionView({
        configurationName: () => props.configurationName,
        onBack: props.onBack,
    });
    const { theme } = useTheme();
    const palette = theme;

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
        {
            pattern: "ctrl+s",
            handler: () => {
                vm.editorPane.saveQuery();
            },
            preventDefault: true,
        },
    ];

    return (
        <KeyScope id="connection-view" bindings={screenKeyBindings}>
            <box flexDirection="column" flexGrow={1} backgroundColor={palette().background}>
                <text fg={palette().accent} marginTop={1} marginLeft={3}>
                    {vm.title()}
                </text>

                <box flexDirection="row" flexGrow={1}>
                    <TreePanel viewModel={vm.treePane} />

                    <box flexDirection="column" flexGrow={1} marginLeft={vm.treePane.visible() ? 1 : 0} justifyContent="space-between">
                        <EditorPanel
                            viewModel={vm.editorPane}
                        />
                        <Show when={vm.resultsPane.visible()}>
                            <ResultsPanel viewModel={vm.resultsPane} />
                        </Show>
                    </box>
                </box>

                <box height={1} minWidth={"100%"}>
                    <text attributes={TextAttributes.DIM} fg={palette().textMuted}>
                        {vm.helpText}
                    </text>
                </box>
            </box>
        </KeyScope>
    );
}
