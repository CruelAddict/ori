import { KeyScope, type KeyBinding } from "@src/core/services/key-scopes";
import type { EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane";
import { QueryEditor } from "@src/ui/components/query-editor";

const EDITOR_SCOPE_ID = "connection-view.editor";

export interface EditorPanelProps {
    viewModel: EditorPaneViewModel;
    configurationName: string;
    borderColor?: (focused: boolean) => string;
}

export function EditorPanel(props: EditorPanelProps) {
    const pane = props.viewModel;

    const bindings: KeyBinding[] = [];

    return (
        <KeyScope id={EDITOR_SCOPE_ID} bindings={bindings} enabled={pane.isFocused}>
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
