import type { Node, OriClient } from "@shared/lib/resources-client"
import type { Logger } from "pino"

export type GraphSnapshot = {
  nodesById: Record<string, Node>
  rootIds: string[]
}

const BATCH_SIZE = 16

export async function loadFullGraph(
  client: OriClient,
  resourceName: string,
  logger?: Logger,
): Promise<GraphSnapshot> {
  logger?.debug({ resource: resourceName }, "schema load starting")
  const nodes = new Map<string, Node>()
  const queue = new Set<string>()

  logger?.debug({ resource: resourceName }, "fetching root nodes")
  const rootNodes = await client.getNodes(resourceName)
  logger?.debug({ resource: resourceName, rootCount: rootNodes.length }, "fetched root nodes")
  for (const node of rootNodes) {
    nodes.set(node.id, node)
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
        "fetching node batch",
      )
      const fetched = await client.getNodes(resourceName, batch)
      logger?.debug({ resource: resourceName, fetchedCount: fetched.length }, "fetched node batch")
      for (const node of fetched) {
        nodes.set(node.id, node)
        enqueueEdges(node, queue, nodes)
      }
    } catch (err) {
      logger?.error({ err, batchSize: batch.length }, "failed to hydrate graph batch")
      throw err
    }
  }

  const result = {
    nodesById: Object.fromEntries(nodes.entries()),
    rootIds: rootNodes.map((node) => node.id),
  }
  logger?.debug(
    { resource: resourceName, totalNodes: nodes.size, rootCount: result.rootIds.length },
    "schema load completed",
  )
  return result
}

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
  logger?.debug({ resource: resourceName }, "schema load starting")
  const nodes = new Map<string, Node>()
  const queue = new Set<string>()

  logger?.debug({ resource: resourceName }, "fetching root nodes")
  const rootNodes = await client.getNodes(resourceName)
  logger?.debug({ resource: resourceName, rootCount: rootNodes.length }, "fetched root nodes")

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
        "fetching node batch",
      )
      const fetched = await client.getNodes(resourceName, batch)
      logger?.debug({ resource: resourceName, fetchedCount: fetched.length }, "fetched node batch")
      for (const node of fetched) {
        nodes.set(node.id, node)
        handlers.onNode?.(node)
        enqueueEdges(node, queue, nodes)
      }
    } catch (err) {
      logger?.error({ err, batchSize: batch.length }, "failed to hydrate graph batch")
      throw err
    }
  }

  const result = {
    nodesById: Object.fromEntries(nodes.entries()),
    rootIds,
  }
  logger?.debug(
    { resource: resourceName, totalNodes: nodes.size, rootCount: result.rootIds.length },
    "schema load completed",
  )
  return result
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
