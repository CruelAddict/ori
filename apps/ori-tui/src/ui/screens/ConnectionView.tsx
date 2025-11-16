import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";
import { KeyScope } from "@src/core/services/keyScopes";
import { QueryEditor } from "@src/ui/components/QueryEditor";
import { QueryResultsPane } from "@src/ui/components/QueryResultsPane";
import { SchemaTreePane } from "@src/ui/components/SchemaTreePane";
import { useConnectionView } from "@src/ui/features/useConnectionView";

export interface ConnectionViewProps {
    configurationName: string;
    onBack: () => void;
}

export function ConnectionView(props: ConnectionViewProps) {
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
                    <Show when={vm.treePane.visible()}>
                        <KeyScope
                            id={vm.treePane.scope.id}
                            bindings={vm.treePane.scope.bindings}
                            enabled={vm.treePane.scope.enabled}
                        >
                            <SchemaTreePane
                                controller={vm.treePane.controller}
                                loading={vm.treePane.loading}
                                error={vm.treePane.error}
                                focused={vm.treePane.isFocused()}
                            />
                        </KeyScope>
                    </Show>

                    <box flexDirection="column" flexGrow={1} marginLeft={vm.treePane.visible() ? 1 : 0}>
                        <KeyScope
                            id={vm.editorPane.scope.id}
                            bindings={vm.editorPane.scope.bindings}
                            enabled={vm.editorPane.scope.enabled}
                        >
                            <box
                                flexDirection="column"
                                flexGrow={vm.resultsPane.visible() ? 1 : 1}
                                borderStyle="single"
                                borderColor={vm.editorPane.isFocused() ? "cyan" : "gray"}
                            >
                                <QueryEditor
                                    configurationName={props.configurationName}
                                    value={vm.editorPane.queryText()}
                                    onChange={vm.actions.onQueryChange}
                                    onExecute={() => {
                                        void vm.actions.executeQuery();
                                    }}
                                    executing={vm.editorPane.isExecuting()}
                                    focused={vm.editorPane.isFocused()}
                                />
                            </box>
                        </KeyScope>

                        <Show when={vm.resultsPane.visible()}>
                            <box height={1} />
                            <KeyScope
                                id={vm.resultsPane.scope.id}
                                bindings={vm.resultsPane.scope.bindings}
                                enabled={vm.resultsPane.scope.enabled}
                            >
                                <box
                                    flexDirection="column"
                                    flexGrow={1}
                                    borderStyle="single"
                                    borderColor={vm.resultsPane.isFocused() ? "cyan" : "gray"}
                                >
                                    <QueryResultsPane
                                        job={vm.resultsPane.job()}
                                        visible={vm.resultsPane.visible()}
                                    />
                                </box>
                            </KeyScope>
                        </Show>
                    </box>
                </box>

                <box height={1} />
                <text attributes={TextAttributes.DIM}>{vm.helpText}</text>
            </box>
        </KeyScope>
    );
}
