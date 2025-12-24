import { useTheme } from "@app/providers/theme";
import { TextAttributes } from "@opentui/core";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import { useConnectionView } from "@src/features/connection/view/use-connection-view";
import { EditorPanel } from "@src/widgets/editor-panel/editor-panel";
import { ResultsPanel } from "@src/widgets/results-panel/results-panel";
import { TreePanel } from "@src/widgets/tree-panel/tree-panel";
import { WelcomePane } from "@src/widgets/welcome-pane/welcome-pane";
import { Statusline } from "@src/widgets/statusline/statusline"
import { createEffect, Show } from "solid-js";

export type ConnectionViewPageProps = {
    configurationName: string;
    isActive?: boolean;
};

export function ConnectionViewPage(props: ConnectionViewPageProps) {
    const vm = useConnectionView({
        configurationName: () => props.configurationName,
    });
    const { theme } = useTheme();
    const palette = theme;
    const scopeEnabled = () => props.isActive ?? true;

    createEffect(() => {
        vm.actions.setActive(scopeEnabled());
    });

    const screenKeyBindings: KeyBinding[] = [
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
            pattern: "ctrl+s",
            handler: () => {
                vm.editorPane.saveQuery();
            },
            preventDefault: true,
        },
        {
            pattern: "q",
            handler: () => {
                if (!vm.editorOpen()) {
                    vm.actions.openEditor();
                    return;
                }
                vm.actions.focusEditor();
            },
            when: () => !vm.editorPane.isFocused(),
            preventDefault: true,
        },
    ];

    return (
        <KeyScope
            bindings={screenKeyBindings}
            enabled={scopeEnabled}
        >
            <box
                flexDirection="column"
                flexGrow={1}
                backgroundColor={palette().background}
            >
                <box
                    flexDirection="row"
                    flexGrow={1}
                >
                    <TreePanel viewModel={vm.treePane} />

                    <box
                        flexDirection="column"
                        flexGrow={1}
                        marginLeft={vm.treePane.visible() ? 1 : 0}
                        zIndex={2}
                        justifyContent="space-between"
                    >
                        <Show
                            when={vm.editorOpen()}
                            fallback={<WelcomePane />}
                        >
                            <EditorPanel viewModel={vm.editorPane} />
                        </Show>
                        <Show when={vm.resultsPane.visible()}>
                            <ResultsPanel viewModel={vm.resultsPane} />
                        </Show>
                    </box>
                </box>

            </box>
            <Statusline title={vm.title()} />
        </KeyScope>
    );
}
