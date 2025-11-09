import { createEffect, createMemo, createResource } from "solid-js";
import type { Accessor } from "solid-js";
import type { GraphSnapshot } from "@src/lib/graph";
import { loadFullGraph } from "@src/lib/graph";
import { useOriClient } from "@src/providers/client";
import { useLogger } from "@src/providers/logger";

interface GraphSnapshotControls {
    snapshot: Accessor<GraphSnapshot | null>;
    loading: Accessor<boolean>;
    error: Accessor<string | null>;
    refresh: () => Promise<GraphSnapshot | null | undefined>;
}

export function useGraphSnapshot(configurationName: Accessor<string | null>): GraphSnapshotControls {
    const client = useOriClient();
    const logger = useLogger();

    const [resource, { refetch }] = createResource<GraphSnapshot | null, string | null>(
        configurationName,
        async (name) => {
            if (!name) {
                return null;
            }
            const snapshot = await loadFullGraph(client, name, logger);
            return snapshot;
        }
    );

    const snapshot = createMemo(() => resource() ?? null);
    const loading = createMemo(() => resource.loading);
    const error = createMemo(() => {
        const err = resource.error;
        if (!err) return null;
        return err instanceof Error ? err.message : String(err);
    });

    createEffect(() => {
        const err = resource.error;
        const name = configurationName();
        if (err && name) {
            logger.error({ err, configuration: name }, "failed to load graph snapshot");
        }
    });

    const refresh = async () => {
        const result = await refetch();
        return result;
    };

    return {
        snapshot,
        loading,
        error,
        refresh,
    };
}
