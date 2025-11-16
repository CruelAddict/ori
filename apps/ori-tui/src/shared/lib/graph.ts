import type { Logger } from "pino";
import type { Node, OriClient } from "@shared/lib/configurationsClient";

export interface GraphSnapshot {
    nodes: Map<string, Node>;
    rootIds: string[];
}

const BATCH_SIZE = 16;

export async function loadFullGraph(
    client: OriClient,
    configurationName: string,
    logger?: Logger
): Promise<GraphSnapshot> {
    const nodes = new Map<string, Node>();
    const queue = new Set<string>();

    const rootNodes = await client.getNodes(configurationName);
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
            const fetched = await client.getNodes(configurationName, batch);
            for (const node of fetched) {
                nodes.set(node.id, node);
                enqueueEdges(node, queue, nodes);
            }
        } catch (err) {
            logger?.error({ err, batchSize: batch.length }, "failed to hydrate graph batch");
            throw err;
        }
    }

    return {
        nodes,
        rootIds: rootNodes.map((node) => node.id),
    };
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
