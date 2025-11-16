import { Show } from "solid-js";
import { KeyScope } from "@src/core/services/keyScopes";
import type { ResultsPaneViewModel } from "@src/features/results-pane/use_results_pane";
import { QueryResultsPane } from "@src/ui/components/QueryResultsPane";

export interface ResultsPanelProps {
    viewModel: ResultsPaneViewModel;
}

export function ResultsPanel(props: ResultsPanelProps) {
    const pane = props.viewModel;

    return (
        <Show when={pane.visible()}>
            <KeyScope id={pane.scope.id} bindings={pane.scope.bindings} enabled={pane.scope.enabled}>
                <box
                    flexDirection="column"
                    flexGrow={1}
                    borderStyle="single"
                    borderColor={pane.isFocused() ? "cyan" : "gray"}
                >
                    <QueryResultsPane job={pane.job()} visible={pane.visible()} />
                </box>
            </KeyScope>
        </Show>
    );
}
