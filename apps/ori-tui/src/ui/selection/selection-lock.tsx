import { createContext, createSignal, createUniqueId, type JSX, onCleanup, useContext } from "solid-js"

export type SelectionSource = "root-mouse-move" | "renderer-selection" | "console-copy"

export type SelectionSnapshot = {
  source: SelectionSource
  text: string | undefined
}

export type SelectionOwnerCallbacks = {
  isSelecting: () => boolean
  onSettle?: () => void
  onClear?: () => void
  readSelected?: (snapshot: SelectionSnapshot) => string | undefined
}

type ActiveSelectionOwner = {
  owner: string
  callbacks: SelectionOwnerCallbacks
  release: () => void
}

type SelectionLockContextValue = {
  tryAcquire: (owner: string, callbacks: SelectionOwnerCallbacks) => boolean
  canAcquire: (owner: string) => boolean
  handleSelectionChange: (owner: string) => void
  clear: (owner: string) => void
  active: () => ActiveSelectionOwner | undefined
}

const SelectionLockContext = createContext<SelectionLockContextValue>()

export function SelectionLockProvider(props: { children: JSX.Element }) {
  const [active, setActive] = createSignal<ActiveSelectionOwner | undefined>()

  const canAcquire = (owner: string) => {
    const current = active()
    return current === undefined || current.owner === owner
  }

  const tryAcquire = (owner: string, callbacks: SelectionOwnerCallbacks) => {
    const current = active()
    if (current) {
      return current.owner === owner
    }

    const next: ActiveSelectionOwner = {
      owner,
      callbacks,
      release: () => {
        setActive((current) => (current === next ? undefined : current))
      },
    }
    setActive(next)
    return true
  }

  const handleSelectionChange = (owner: string) => {
    queueMicrotask(() => {
      const current = active()
      if (current?.owner !== owner) {
        return
      }
      if (current.callbacks.isSelecting()) {
        return
      }
      current.release()
    })
  }

  const clear = (owner: string) => {
    const current = active()
    if (current?.owner !== owner) {
      return
    }

    current.callbacks.onClear?.()
    current.release()
  }

  return (
    <SelectionLockContext.Provider value={{ tryAcquire, canAcquire, handleSelectionChange, clear, active }}>
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

  onCleanup(() => {
    const current = lock.active()
    if (current?.owner === owner) {
      current.release()
    }
  })

  return {
    tryAcquire: (callbacks: SelectionOwnerCallbacks) => lock.tryAcquire(owner, callbacks),
    canAcquire: () => lock.canAcquire(owner),
    handleSelectionChange: () => lock.handleSelectionChange(owner),
    clear: () => lock.clear(owner),
  }
}

export function useActiveSelectionOwner() {
  const lock = useSelectionLockContext()

  return {
    active: lock.active,
  }
}
