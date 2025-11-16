import { KeyScope } from "@src/core/services/keyScopes";
import type { EditorPaneViewModel } from "@src/features/editor-pane/use_editor_pane";
import { QueryEditor } from "@src/ui/components/QueryEditor";

export interface EditorPanelProps {
    viewModel: EditorPaneViewModel;
    configurationName: string;
    borderColor?: (focused: boolean) => string;
}

export function EditorPanel(props: EditorPanelProps) {
    const pane = props.viewModel;

    return (
        <KeyScope id={pane.scope.id} bindings={pane.scope.bindings} enabled={pane.scope.enabled}>
            <box
                flexDirection="column"
                flexGrow={1}
                borderStyle="single"
                borderColor={pane.isFocused() ? "cyan" : props.borderColor?.(pane.isFocused()) ?? "gray"}
            >
                <QueryEditor
                    configurationName={props.configurationName}
                    value={pane.queryText()}
                    onChange={pane.onQueryChange}
                    onExecute={() => {
                        void pane.executeQuery();
                    }}
                    executing={pane.isExecuting()}
                    focused={pane.isFocused()}
                />
            </box>
        </KeyScope>
    );
}
