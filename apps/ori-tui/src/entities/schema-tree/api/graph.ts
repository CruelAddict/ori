import type { Node, OriClient } from "@shared/lib/configurations-client";
import type { Logger } from "pino";

export type GraphSnapshot = {
  nodes: Map<string, Node>;
  rootIds: string[];
};

const BATCH_SIZE = 16;

export async function loadFullGraph(
  client: OriClient,
  configurationName: string,
  logger?: Logger,
): Promise<GraphSnapshot> {
  logger?.debug({ configuration: configurationName }, "schema load starting");
  const nodes = new Map<string, Node>();
  const queue = new Set<string>();

  logger?.debug({ configuration: configurationName }, "fetching root nodes");
  const rootNodes = await client.getNodes(configurationName);
  logger?.debug({ configuration: configurationName, rootCount: rootNodes.length }, "fetched root nodes");
  for (const node of rootNodes) {
    nodes.set(node.id, node);
    enqueueEdges(node, queue, nodes);
  }

  while (queue.size > 0) {
    const batch = Array.from(queue).slice(0, BATCH_SIZE);
    for (const id of batch) {
      queue.delete(id);
    }

    try {
      logger?.debug(
        { configuration: configurationName, batchSize: batch.length, queueRemaining: queue.size },
        "fetching node batch",
      );
      const fetched = await client.getNodes(configurationName, batch);
      logger?.debug({ configuration: configurationName, fetchedCount: fetched.length }, "fetched node batch");
      for (const node of fetched) {
        nodes.set(node.id, node);
        enqueueEdges(node, queue, nodes);
      }
    } catch (err) {
      logger?.error({ err, batchSize: batch.length }, "failed to hydrate graph batch");
      throw err;
    }
  }

  const result = {
    nodes,
    rootIds: rootNodes.map((node) => node.id),
  };
  logger?.debug(
    { configuration: configurationName, totalNodes: nodes.size, rootCount: result.rootIds.length },
    "schema load completed",
  );
  return result;
}

function enqueueEdges(node: Node, queue: Set<string>, knownNodes: Map<string, Node>) {
  for (const edge of Object.values(node.edges ?? {})) {
    for (const targetId of edge.items) {
      if (!knownNodes.has(targetId)) {
        queue.add(targetId);
      }
    }
  }
}
