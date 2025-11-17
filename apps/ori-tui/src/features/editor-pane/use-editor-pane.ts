import { createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { PaneFocusController } from "@src/features/connection/view/pane-types";
import { useQueryJobs, type QueryJob } from "@src/entities/query-job/providers/query-jobs-provider";

export interface EditorPaneViewModel {
    queryText: Accessor<string>;
    currentJob: Accessor<QueryJob | undefined>;
    isExecuting: Accessor<boolean>;
    onQueryChange: (text: string) => void;
    executeQuery: () => Promise<void>;
    isFocused: Accessor<boolean>;
}

interface UseEditorPaneOptions {
    configurationName: Accessor<string>;
    focus: PaneFocusController;
}

export function useEditorPane(options: UseEditorPaneOptions): EditorPaneViewModel {
    const queryJobs = useQueryJobs();

    const queryText = createMemo(() => queryJobs.getQueryText(options.configurationName()));
    const currentJob = createMemo(() => queryJobs.getJob(options.configurationName()));
    const isExecuting = createMemo(() => currentJob()?.status === "running");

    const onQueryChange = (text: string) => {
        queryJobs.setQueryText(options.configurationName(), text);
    };

    const executeQuery = async () => {
        const text = queryText();
        if (!text.trim()) {
            return;
        }
        await queryJobs.executeQuery(options.configurationName(), text);
    };

    return {
        queryText,
        currentJob,
        isExecuting,
        onQueryChange,
        executeQuery,
        isFocused: options.focus.isFocused,
    };
}
