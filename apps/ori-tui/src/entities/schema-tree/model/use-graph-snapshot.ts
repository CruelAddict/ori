import { useOriClient } from "@app/providers/client";
import { useLogger } from "@app/providers/logger";
import type { Accessor } from "solid-js";
import { createEffect, createMemo, createResource } from "solid-js";
import type { GraphSnapshot } from "../api/graph";
import { loadFullGraph } from "../api/graph";

type GraphSnapshotControls = {
  snapshot: Accessor<GraphSnapshot | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  refresh: () => Promise<GraphSnapshot | null | undefined>;
};

export function useGraphSnapshot(configurationName: Accessor<string | null>): GraphSnapshotControls {
  const client = useOriClient();
  const logger = useLogger();

  const [resource, { refetch }] = createResource<GraphSnapshot | null, string | null>(
    configurationName,
    async (name) => {
      if (!name) {
        return null;
      }
      logger.debug({ configuration: name }, "graph snapshot fetch triggered");
      const snapshot = await loadFullGraph(client, name, logger);
      logger.debug({ configuration: name, hasSnapshot: !!snapshot }, "graph snapshot fetch completed");
      return snapshot;
    },
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
    if (err) {
      logger.error({ err, configuration: name }, "graph snapshot load failed");
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
