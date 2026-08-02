import { useRenderer } from "@opentui/solid"
import { useLogger } from "@ui/providers/logger"
import { copyTextToClipboard } from "@utils/clipboard"
import {
  type Accessor,
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  onCleanup,
  useContext,
} from "solid-js"

export type SelectionAction = {
  key: "y" | "ctrl+y" | "ctrl+k" | "backspace"
  label: "copy" | "cut" | "delete"
  run: () => void
}

export type CurrentSelection = {
  text: string
  cut?: () => void | Promise<void>
  delete?: () => void | Promise<void>
}

export type SelectionOwnerOptions = {
  pane: "editor" | "results"
  readSelection: Accessor<CurrentSelection | undefined>
  clearSelection: () => void
  onDragEnd?: () => void
}

type SelectionOwner = {
  owner: string
  options: SelectionOwnerOptions
}

type PendingAction = {
  owner: SelectionOwner
  selection: CurrentSelection
}

type RendererWithConsoleSelection = {
  console?: {
    onCopySelection?: (text: string) => void | Promise<void>
  }
}

type SelectionContextValue = {
  tryAcquire: (owner: string, options: SelectionOwnerOptions) => boolean
  register: (owner: string, options: SelectionOwnerOptions) => boolean
  canAcquire: (owner: string) => boolean
  clearOwner: (owner: string) => void
  clear: () => void
  clearPane: (pane: SelectionOwnerOptions["pane"]) => void
  handleMouseUp: () => void
  subscribeNativeEvents: () => () => void
  isActive: () => boolean
  isDragging: () => boolean
  actions: () => readonly SelectionAction[]
}

const SelectionContext = createContext<SelectionContextValue>()

export function SelectionProvider(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const logger = useLogger()
  const [activeOwner, setActiveOwner] = createSignal<SelectionOwner | undefined>()
  const [dragging, setDragging] = createSignal(false)
  const [pending, setPending] = createSignal<PendingAction | undefined>()
  let settling = false

  const clearNativeSelection = () => {
    try {
      renderer.clearSelection()
    } catch (err) {
      logger.warn({ err }, "selection: failed to clear native selection")
    }
  }

  const clearActiveOwner = (expected?: SelectionOwner, clearNative = true) => {
    const current = activeOwner()
    if (!current) {
      return false
    }
    if (expected !== undefined && current !== expected) {
      return false
    }

    batch(() => {
      setActiveOwner(undefined)
      setDragging(false)
      setPending(undefined)
    })
    if (clearNative) {
      clearNativeSelection()
    }
    current.options.clearSelection()
    return true
  }

  const clear = () => {
    clearActiveOwner()
  }

  const clearOwner = (owner: string) => {
    const current = activeOwner()
    if (current?.owner === owner) {
      clearActiveOwner(current)
    }
  }

  const clearPane = (pane: SelectionOwnerOptions["pane"]) => {
    const current = activeOwner()
    if (current?.options.pane === pane) {
      clearActiveOwner(current)
    }
  }

  const currentSelection = createMemo(() => {
    const current = activeOwner()
    if (!current) {
      return undefined
    }

    return current.options.readSelection()
  })

  const beginAction = (owner: SelectionOwner) => {
    if (pending()) {
      return undefined
    }

    const selection = currentSelection()
    if (!selection || activeOwner() !== owner) {
      return undefined
    }

    const action = { owner, selection }
    setPending(action)
    return action
  }

  const finishAction = (action: PendingAction) => {
    setPending((current) => (current === action ? undefined : current))
  }

  const isUnchanged = (owner: SelectionOwner, action: PendingAction) => {
    return activeOwner() === owner && currentSelection() === action.selection
  }

  const copy = async (owner: SelectionOwner) => {
    const current = beginAction(owner)
    if (!current) {
      return
    }

    try {
      const copied = await copyTextToClipboard(current.selection.text, { renderer, logger })
      if (!copied) {
        logger.warn("selection: clipboard copy was rejected")
        return
      }
      if (isUnchanged(owner, current)) {
        clearActiveOwner(owner)
      }
    } catch (err) {
      logger.error({ err }, "selection: failed to copy selection")
    } finally {
      finishAction(current)
    }
  }

  const cut = async (owner: SelectionOwner) => {
    const current = beginAction(owner)
    if (!current) {
      return
    }
    if (!current.selection.cut) {
      finishAction(current)
      return
    }

    try {
      const copied = await copyTextToClipboard(current.selection.text, { renderer, logger })
      if (!copied) {
        logger.warn("selection: clipboard copy was rejected")
        return
      }
      if (!isUnchanged(owner, current)) {
        return
      }
      await current.selection.cut()
      if (isUnchanged(owner, current)) {
        clearActiveOwner(owner)
      }
    } catch (err) {
      logger.error({ err }, "selection: failed to cut selection")
    } finally {
      finishAction(current)
    }
  }

  const remove = async (owner: SelectionOwner) => {
    const current = beginAction(owner)
    if (!current) {
      return
    }
    if (!current.selection.delete) {
      finishAction(current)
      return
    }

    try {
      await current.selection.delete()
      if (isUnchanged(owner, current)) {
        clearActiveOwner(owner)
      }
    } catch (err) {
      logger.error({ err }, "selection: failed to delete selection")
    } finally {
      finishAction(current)
    }
  }

  const actions = createMemo<readonly SelectionAction[]>(() => {
    const owner = activeOwner()
    const selection = currentSelection()
    if (!owner || dragging() || !selection) {
      return []
    }

    const available: SelectionAction[] = [
      { key: owner.options.pane === "editor" ? "ctrl+y" : "y", label: "copy", run: () => void copy(owner) },
    ]
    if (selection.cut) {
      available.push({ key: "ctrl+k", label: "cut", run: () => void cut(owner) })
    }
    if (selection.delete) {
      available.push({ key: "backspace", label: "delete", run: () => void remove(owner) })
    }
    return available
  })

  const canAcquire = (owner: string) => {
    const current = activeOwner()
    return !dragging() || current?.owner === owner
  }

  const tryAcquire = (owner: string, options: SelectionOwnerOptions) => {
    if (!canAcquire(owner)) {
      return false
    }

    clearActiveOwner(undefined, false)
    batch(() => {
      setActiveOwner({ owner, options })
      setDragging(true)
    })
    return true
  }

  const register = (owner: string, options: SelectionOwnerOptions) => {
    const current = activeOwner()
    if (!options.readSelection()) {
      return false
    }
    if (current?.owner === owner) {
      return true
    }
    if (!canAcquire(owner)) {
      return false
    }

    clearActiveOwner(undefined, false)
    setActiveOwner({ owner, options })
    return true
  }

  const settleSelection = (expected: SelectionOwner) => {
    if (settling) {
      return
    }

    const current = activeOwner()
    if (!current || current !== expected || !dragging()) {
      return
    }

    settling = true
    try {
      current.options.onDragEnd?.()
      if (current.options.readSelection()) {
        setDragging(false)
        return
      }

      clearActiveOwner(current)
    } catch (err) {
      logger.error({ err }, "selection: failed to finish drag")
      clearActiveOwner(current)
    } finally {
      settling = false
    }
  }

  const handleMouseUp = () => {
    const current = activeOwner()
    if (!current || !dragging()) {
      return
    }

    if (!renderer.getSelection?.()?.isDragging) {
      settleSelection(current)
      return
    }

    queueMicrotask(() => settleSelection(current))
  }

  createEffect(() => {
    const current = activeOwner()
    if (!current || dragging() || currentSelection()) {
      return
    }

    clearActiveOwner(current)
  })

  const startNativeEvents = () => {
    const rendererConsole = (renderer as unknown as RendererWithConsoleSelection).console
    const previous = rendererConsole?.onCopySelection
    const onCopySelection = (text: string) => {
      void copyTextToClipboard(text, { renderer, logger }).catch((err) => {
        logger.error({ err }, "selection: failed to copy console selection")
      })
    }
    if (rendererConsole) {
      rendererConsole.onCopySelection = onCopySelection
    }

    return () => {
      if (rendererConsole?.onCopySelection === onCopySelection) {
        rendererConsole.onCopySelection = previous
      }
    }
  }

  let nativeEventSubscribers = 0
  let stopNativeEvents: (() => void) | undefined

  const subscribeNativeEvents = () => {
    nativeEventSubscribers += 1
    if (nativeEventSubscribers === 1) {
      stopNativeEvents = startNativeEvents()
    }

    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }

      subscribed = false
      nativeEventSubscribers -= 1
      if (nativeEventSubscribers !== 0) {
        return
      }

      stopNativeEvents?.()
      stopNativeEvents = undefined
    }
  }

  return (
    <SelectionContext.Provider
      value={{
        tryAcquire,
        register,
        canAcquire,
        clearOwner,
        clear,
        clearPane,
        handleMouseUp,
        subscribeNativeEvents,
        isActive: () => dragging() || Boolean(currentSelection()),
        isDragging: () => Boolean(renderer.getSelection?.()?.isDragging),
        actions,
      }}
    >
      {props.children}
    </SelectionContext.Provider>
  )
}

function useSelectionContext() {
  const context = useContext(SelectionContext)
  if (!context) {
    throw new Error("SelectionProvider is missing in component tree")
  }

  return context
}

export function useSelectionOwner(options: SelectionOwnerOptions) {
  const selection = useSelectionContext()
  const owner = createUniqueId()

  onCleanup(() => selection.clearOwner(owner))

  return {
    tryAcquire: () => selection.tryAcquire(owner, options),
    register: () => selection.register(owner, options),
    canAcquire: () => selection.canAcquire(owner),
    clear: () => selection.clearOwner(owner),
  }
}

export function useSelection() {
  const selection = useSelectionContext()

  onCleanup(selection.subscribeNativeEvents())

  return {
    handleMouseUp: selection.handleMouseUp,
    isActive: selection.isActive,
    isDragging: selection.isDragging,
    actions: selection.actions,
    clear: selection.clear,
    clearPane: selection.clearPane,
  }
}
