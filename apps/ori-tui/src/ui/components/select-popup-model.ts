import { type Accessor, batch, createSignal } from "solid-js"
import type { ContainerHeight, ContainerWidth, ContainerX, ContainerY } from "./buffer/coords"

export type SelectPopupAnchor = {
  x: ContainerX
  y: ContainerY
  containerWidth: ContainerWidth
  containerHeight: ContainerHeight
}

export type SelectPopupItem = {
  id: string
  label: string
  description?: string
  meta?: string
}

export type SelectPopupViewModel<T extends SelectPopupItem = SelectPopupItem> = {
  anchor: Accessor<SelectPopupAnchor | null>
  items: Accessor<readonly T[]>
  selectedIndex: Accessor<number>
  close: () => void
  move: (delta: -1 | 1) => void
  hover: (index: number) => void
  select: () => boolean
}

export type SelectPopupModel<T extends SelectPopupItem = SelectPopupItem> = SelectPopupViewModel<T> & {
  setAnchor: (anchor: SelectPopupAnchor | null) => void
  setItems: (items: readonly T[], options?: { selectedIndex?: number }) => void
}

type CreateSelectPopupOptions<T extends SelectPopupItem> = {
  onSelect: (item: T) => boolean
  onClose?: () => void
}

type SelectableItem = {
  id: string
}

function getSelectedIndex<T extends SelectableItem>(current: readonly T[], currentIndex: number, next: readonly T[]) {
  const selected = current[currentIndex]
  if (!selected) {
    return 0
  }

  const index = next.findIndex((item) => item.id === selected.id)
  if (index >= 0) {
    return index
  }

  return 0
}

export function createSelectPopup<T extends SelectPopupItem>(
  options: CreateSelectPopupOptions<T>,
): SelectPopupModel<T> {
  const [anchor, setAnchor] = createSignal<SelectPopupAnchor | null>(null)
  const [items, setItemsValue] = createSignal<readonly T[]>([])
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const close = () => {
    setAnchor(null)
    setItemsValue([])
    setSelectedIndex(0)
    options.onClose?.()
  }

  const setItems = (next: readonly T[], nextOptions?: { selectedIndex?: number }) => {
    const current = items()
    const currentIndex = selectedIndex()
    const nextIndex =
      typeof nextOptions?.selectedIndex === "number" &&
      nextOptions.selectedIndex >= 0 &&
      nextOptions.selectedIndex < next.length
        ? nextOptions.selectedIndex
        : getSelectedIndex(current, currentIndex, next)

    batch(() => {
      setItemsValue(next)
      setSelectedIndex(nextIndex)
    })
  }

  const move = (delta: -1 | 1) => {
    const size = items().length
    if (size === 0) {
      return
    }

    const current = selectedIndex()
    const next = (current + delta + size) % size
    setSelectedIndex(next)
  }

  const hover = (index: number) => {
    const size = items().length
    if (index < 0 || index >= size || selectedIndex() === index) {
      return
    }

    setSelectedIndex(index)
  }

  const select = () => {
    const item = items()[selectedIndex()]
    if (!item) {
      return false
    }

    const applied = options.onSelect(item)
    if (!applied) {
      return false
    }

    close()
    return true
  }

  return {
    anchor,
    items,
    selectedIndex,
    setAnchor,
    setItems,
    close,
    move,
    hover,
    select,
  }
}
