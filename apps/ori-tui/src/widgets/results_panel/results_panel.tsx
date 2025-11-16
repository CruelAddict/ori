import { Show } from "solid-js";
import { KeyScope, type KeyBinding } from "@src/core/services/keyScopes";
import type { ResultsPaneViewModel } from "@src/features/results-pane/use_results_pane";
import { QueryResultsPane } from "@src/ui/components/QueryResultsPane";

const RESULTS_SCOPE_ID = "connection-view.results";

export interface ResultsPanelProps {
    viewModel: ResultsPaneViewModel;
}

export function ResultsPanel(props: ResultsPanelProps) {
    const pane = props.viewModel;

    const bindings: KeyBinding[] = [];
    const enabled = () => pane.visible() && pane.isFocused();

    return (
        <Show when={pane.visible()}>
            <KeyScope id={RESULTS_SCOPE_ID} bindings={bindings} enabled={enabled}>
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
