import { useRenderer } from "@opentui/solid"
import { useLogger } from "@ui/providers/logger"
import { copyTextToClipboard } from "@utils/clipboard"
import { createContext, createMemo, createSignal, createUniqueId, type JSX, onCleanup, useContext } from "solid-js"

export type SelectionSource = "root-mouse-move" | "root-mouse-up" | "renderer-selection" | "console-copy"

export type SelectionSnapshot = {
  source: SelectionSource
  text: string | undefined
}

export type AppSelectionAction = {
  key: "y" | "ctrl+y" | "ctrl+k" | "backspace"
  label: "copy" | "cut" | "delete"
  run: () => void
}

export type AppSelection = {
  actions: readonly AppSelectionAction[]
}

export type SelectionCapture = {
  text: string
  clearVisual: () => void
  restoreVisual: () => void
  cut?: () => void | Promise<void>
  delete?: () => void | Promise<void>
}

export type SelectionOwnerCallbacks = {
  pane: "editor" | "results"
  isSelecting: () => boolean
  onSettle?: () => void
  onCancel?: () => void
  capture?: (snapshot: SelectionSnapshot) => SelectionCapture | undefined
}

type ActiveSelectionOwner = {
  owner: string
  generation: number
  callbacks: SelectionOwnerCallbacks
  release: () => void
}

type RetainedSelection = SelectionCapture & {
  owner: string
  pane: "editor" | "results"
  generation: number
  pending: boolean
}

type SelectionLockContextValue = {
  tryAcquire: (owner: string, callbacks: SelectionOwnerCallbacks) => boolean
  canAcquire: (owner: string) => boolean
  handleSelectionChange: (owner: string) => void
  cancelActive: () => void
  clearOwner: (owner: string) => void
  clearRetained: () => void
  clearRetainedByOwner: (owner: string) => void
  clearPane: (pane: RetainedSelection["pane"]) => void
  commit: (active: ActiveSelectionOwner, capture: SelectionCapture) => void
  restore: (active: ActiveSelectionOwner | undefined) => void
  active: () => ActiveSelectionOwner | undefined
  selection: () => AppSelection | undefined
  hasRetained: (owner: string) => boolean
  isGestureActive: (owner: string) => boolean
}

const SelectionLockContext = createContext<SelectionLockContextValue>()

export function SelectionLockProvider(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const logger = useLogger()
  const [active, setActive] = createSignal<ActiveSelectionOwner | undefined>()
  const [retained, setRetained] = createSignal<RetainedSelection | undefined>()
  let generation = 0

  const isCurrent = (record: RetainedSelection) => {
    const current = retained()
    return current?.owner === record.owner && current.generation === record.generation
  }

  const clearRecord = (record?: RetainedSelection) => {
    const current = retained()
    if (!current || (record && !isCurrent(record))) {
      return
    }

    // Clear state before the owner callback so an owner invalidation cannot recurse into this record.
    setRetained(undefined)
    current.clearVisual()
  }

  const setPending = (record: RetainedSelection, pending: boolean) => {
    setRetained((current) => {
      if (!current || current.owner !== record.owner || current.generation !== record.generation) {
        return current
      }
      return { ...current, pending }
    })
  }

  const beginAction = (record: RetainedSelection) => {
    const current = retained()
    if (!current || current.owner !== record.owner || current.generation !== record.generation || current.pending) {
      return false
    }

    setPending(record, true)
    return true
  }

  const copy = async (record: RetainedSelection) => {
    if (!beginAction(record)) {
      return
    }

    try {
      const copied = await copyTextToClipboard(record.text, { renderer, logger })
      if (!copied) {
        logger.warn("selection: clipboard copy was rejected")
        setPending(record, false)
        return
      }
      clearRecord(record)
    } catch (err) {
      logger.error({ err }, "selection: failed to copy retained selection")
      setPending(record, false)
    }
  }

  const cut = async (record: RetainedSelection) => {
    if (!record.cut || !beginAction(record)) {
      return
    }

    try {
      const copied = await copyTextToClipboard(record.text, { renderer, logger })
      if (!copied) {
        logger.warn("selection: clipboard copy was rejected")
        setPending(record, false)
        return
      }
      if (!isCurrent(record)) {
        return
      }
      await record.cut()
      clearRecord(record)
    } catch (err) {
      logger.error({ err }, "selection: failed to cut retained selection")
      setPending(record, false)
    }
  }

  const remove = async (record: RetainedSelection) => {
    if (!record.delete || !beginAction(record)) {
      return
    }

    try {
      await record.delete()
      clearRecord(record)
    } catch (err) {
      logger.error({ err }, "selection: failed to delete retained selection")
      setPending(record, false)
    }
  }

  const selection = createMemo<AppSelection | undefined>(() => {
    const record = retained()
    if (!record) {
      return undefined
    }

    const actions: AppSelectionAction[] = [
      { key: record.pane === "editor" ? "ctrl+y" : "y", label: "copy", run: () => void copy(record) },
    ]
    if (record.cut) {
      actions.push({ key: "ctrl+k", label: "cut", run: () => void cut(record) })
    }
    if (record.delete) {
      actions.push({ key: "backspace", label: "delete", run: () => void remove(record) })
    }
    return { actions }
  })

  const canAcquire = (owner: string) => {
    const current = active()
    return current === undefined || current.owner === owner
  }

  const tryAcquire = (owner: string, callbacks: SelectionOwnerCallbacks) => {
    const current = active()
    if (current && current.owner !== owner) {
      return false
    }

    clearRecord()
    if (current) {
      current.callbacks = callbacks
      return true
    }

    const next: ActiveSelectionOwner = {
      owner,
      generation: ++generation,
      callbacks,
      release: () => {
        setActive((value) => (value === next ? undefined : value))
      },
    }
    setActive(next)
    return true
  }

  const cancelActive = () => {
    const current = active()
    if (!current) {
      return
    }

    current.callbacks.onCancel?.()
    current.release()
  }

  const clearOwner = (owner: string) => {
    const current = active()
    if (current?.owner === owner) {
      current.callbacks.onCancel?.()
      current.release()
    }

    const record = retained()
    if (record?.owner === owner) {
      clearRecord(record)
    }
  }

  const commit = (current: ActiveSelectionOwner, capture: SelectionCapture) => {
    if (active() !== current || capture.text.length === 0) {
      return
    }

    setRetained({
      ...capture,
      owner: current.owner,
      pane: current.callbacks.pane,
      generation: current.generation,
      pending: false,
    })
  }

  const restore = (current: ActiveSelectionOwner | undefined) => {
    if (!current) {
      return
    }

    const record = retained()
    if (record?.owner !== current.owner || record.generation !== current.generation) {
      return
    }

    record.restoreVisual()
  }

  return (
    <SelectionLockContext.Provider
      value={{
        tryAcquire,
        canAcquire,
        handleSelectionChange: () => {},
        cancelActive,
        clearOwner,
        clearRetained: () => clearRecord(),
        clearRetainedByOwner: (owner) => {
          const record = retained()
          if (record?.owner === owner) {
            clearRecord(record)
          }
        },
        clearPane: (pane) => {
          const record = retained()
          if (record?.pane === pane) {
            clearRecord(record)
          }
        },
        commit,
        restore,
        active,
        selection,
        hasRetained: (owner) => retained()?.owner === owner,
        isGestureActive: (owner) => active()?.owner === owner,
      }}
    >
      {props.children}
    </SelectionLockContext.Provider>
  )
}

function useSelectionLockContext() {
  const context = useContext(SelectionLockContext)
  if (!context) {
    throw new Error("SelectionLockProvider is missing in component tree")
  }

  return context
}

export function useSelectionLock() {
  const lock = useSelectionLockContext()
  const owner = createUniqueId()

  onCleanup(() => lock.clearOwner(owner))

  return {
    tryAcquire: (callbacks: SelectionOwnerCallbacks) => lock.tryAcquire(owner, callbacks),
    canAcquire: () => lock.canAcquire(owner),
    handleSelectionChange: () => lock.handleSelectionChange(owner),
    clear: () => lock.clearOwner(owner),
    clearRetained: () => lock.clearRetainedByOwner(owner),
    hasRetained: () => lock.hasRetained(owner),
    isGestureActive: () => lock.isGestureActive(owner),
  }
}

export function useActiveSelectionOwner() {
  const lock = useSelectionLockContext()

  return {
    active: lock.active,
    cancelActive: lock.cancelActive,
    clearRetained: lock.clearRetained,
    selection: lock.selection,
    commit: lock.commit,
    restore: lock.restore,
  }
}

export function useSelectionService() {
  const lock = useSelectionLockContext()

  return {
    clearPane: lock.clearPane,
  }
}
