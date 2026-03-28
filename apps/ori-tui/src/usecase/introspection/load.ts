import type { Node, OriClient } from "@adapters/ori/client"
import type { Logger } from "pino"

export type GraphSnapshot = {
  nodesById: Record<string, Node>
  rootIds: string[]
}

const BATCH_SIZE = 16

type GraphIncrementalHandlers = {
  onRoots?: (nodes: Node[], rootIds: string[]) => void
  onNodes?: (nodes: Node[]) => void
  onNode?: (node: Node) => void
}

export async function loadGraphIncremental(
  client: OriClient,
  resourceName: string,
  handlers: GraphIncrementalHandlers,
  logger?: Logger,
): Promise<GraphSnapshot> {
  logger?.debug({ resource: resourceName }, "resource introspection load started")
  const nodes = new Map<string, Node>()
  const rootNodes = await client.getNodes(resourceName)
  const rootIds = rootNodes.map((node) => node.id)
  handlers.onRoots?.(rootNodes, rootIds)
  handlers.onNodes?.(rootNodes)

  for (const node of rootNodes) {
    nodes.set(node.id, node)
    handlers.onNode?.(node)
  }

  await hydrateGraphIncremental(client, resourceName, rootIds, nodes, handlers, logger)

  const snapshot: GraphSnapshot = {
    nodesById: Object.fromEntries(nodes.entries()),
    rootIds,
  }

  logger?.debug(
    {
      resource: resourceName,
      totalNodes: nodes.size,
      rootCount: rootIds.length,
    },
    "resource introspection load completed",
  )

  return snapshot
}

export async function hydrateGraphIncremental(
  client: OriClient,
  resourceName: string,
  nodeIds: string[],
  knownNodes: Map<string, Node>,
  handlers: GraphIncrementalHandlers,
  logger?: Logger,
): Promise<void> {
  const queue = new Set<string>()
  for (const nodeId of nodeIds) {
    if (knownNodes.has(nodeId)) {
      const node = knownNodes.get(nodeId)
      if (node) enqueueEdges(node, queue, knownNodes)
      continue
    }
    queue.add(nodeId)
  }

  while (queue.size > 0) {
    const batch = Array.from(queue).slice(0, BATCH_SIZE)
    for (const id of batch) {
      queue.delete(id)
    }

    try {
      logger?.debug(
        { resource: resourceName, batchSize: batch.length, queueRemaining: queue.size },
        "resource introspection: fetching node batch",
      )
      const fetched = await client.getNodes(resourceName, batch)
      handlers.onNodes?.(fetched)
      for (const node of fetched) {
        knownNodes.set(node.id, node)
        handlers.onNode?.(node)
        enqueueEdges(node, queue, knownNodes)
      }
    } catch (err) {
      logger?.error({ err, batchSize: batch.length }, "resource introspection: failed to hydrate node batch")
      throw err
    }
  }
}

function enqueueEdges(node: Node, queue: Set<string>, knownNodes: Map<string, Node>) {
  for (const edge of Object.values(node.edges ?? {})) {
    for (const targetId of edge.items) {
      if (!knownNodes.has(targetId)) {
        queue.add(targetId)
      }
    }
  }
}
