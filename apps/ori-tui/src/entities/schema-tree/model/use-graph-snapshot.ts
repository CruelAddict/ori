import { useOriClient } from "@app/providers/client"
import { useLogger } from "@app/providers/logger"
import type { Accessor } from "solid-js"
import { createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { GraphSnapshot } from "../api/graph"
import { loadGraphIncremental } from "../api/graph"
import type { Node } from "@shared/lib/configurations-client"

type GraphSnapshotControls = {
  nodesById: Accessor<Record<string, Node>>
  rootIds: Accessor<string[]>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  refresh: () => Promise<GraphSnapshot | null | undefined>
}

export function useResourceGraphSnapshot(configurationName: Accessor<string | null>): GraphSnapshotControls {
  const client = useOriClient()
  const logger = useLogger()

  const [nodesById, setNodesById] = createStore<Record<string, Node>>({})
  const [rootIds, setRootIds] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  let requestId = 0

  const clearState = () => {
    setNodesById({})
    setRootIds([])
  }

  const loadGraph = async (name: string): Promise<GraphSnapshot | null> => {
    const currentRequest = ++requestId
    setLoading(true)
    setError(null)
    clearState()

    logger.debug({ configuration: name }, "graph snapshot fetch triggered")

    try {
      const snapshot = await loadGraphIncremental(
        client,
        name,
        {
          onRoots: (_nodes, ids) => {
            if (requestId !== currentRequest) return
            setRootIds(ids)
          },
          onNode: (node) => {
            if (requestId !== currentRequest) return
            setNodesById(node.id, node)
          },
        },
        logger,
      )

      if (requestId !== currentRequest) return null
      logger.debug({ configuration: name, hasSnapshot: !!snapshot }, "graph snapshot fetch completed")
      setLoading(false)
      return snapshot
    } catch (err) {
      if (requestId !== currentRequest) return null
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ err, configuration: name }, "graph snapshot load failed")
      setError(message)
      setLoading(false)
      return null
    }
  }

  createEffect(() => {
    const name = configurationName()
    if (!name) {
      setLoading(false)
      setError(null)
      clearState()
      return
    }
    void loadGraph(name)
  })

  const refresh = async () => {
    const name = configurationName()
    if (!name) return null
    return loadGraph(name)
  }

  return {
    nodesById: createMemo(() => nodesById),
    rootIds,
    loading,
    error,
    refresh,
  }
}
