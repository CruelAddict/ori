import type { Node, OriClient } from "@shared/lib/resources-client"
import type { Logger } from "pino"

export type GraphSnapshot = {
  nodesById: Record<string, Node>
  rootIds: string[]
}

const BATCH_SIZE = 16

type GraphIncrementalHandlers = {
  onRoots?: (nodes: Node[], rootIds: string[]) => void
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
  const queue = new Set<string>()

  const rootNodes = await client.getNodes(resourceName)
  const rootIds = rootNodes.map((node) => node.id)
  handlers.onRoots?.(rootNodes, rootIds)

  for (const node of rootNodes) {
    nodes.set(node.id, node)
    handlers.onNode?.(node)
    enqueueEdges(node, queue, nodes)
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
      for (const node of fetched) {
        nodes.set(node.id, node)
        handlers.onNode?.(node)
        enqueueEdges(node, queue, nodes)
      }
    } catch (err) {
      logger?.error({ err, batchSize: batch.length }, "resource introspection: failed to hydrate node batch")
      throw err
    }
  }

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

function enqueueEdges(node: Node, queue: Set<string>, knownNodes: Map<string, Node>) {
  for (const edge of Object.values(node.edges ?? {})) {
    for (const targetId of edge.items) {
      if (!knownNodes.has(targetId)) {
        queue.add(targetId)
      }
    }
  }
}
