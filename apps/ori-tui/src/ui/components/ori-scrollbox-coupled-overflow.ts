import type { ScrollBoxRenderable } from "@opentui/core"

type ScrollbarOptions = {
  visible?: boolean
}

type Patch = {
  x: boolean
  y: boolean
  w: number
  h: number
}

type Box = {
  recalculateBarProps: () => void
  __oriCoupledOverflowPatch?: Patch
}

// OpenTUI decides horizontal and vertical scrollbar visibility independently from the
// already-shrunk viewport. That creates a feedback loop: a real horizontal scrollbar
// steals 1 row and suddenly vertical overflow appears by exactly 1 row; a real vertical
// scrollbar steals 1 column and suddenly horizontal overflow appears by exactly 1 column.
// This patch monkey-patches `recalculateBarProps()` so both axes are resolved from the
// pre-scrollbar viewport first, then the original OpenTUI logic runs with the corrected
// scrollbar visibility. We also clamp scrollTop/scrollLeft against the patched viewport
// sizes so the fake extra row/column cannot scroll.
export function needsCoupledOverflowPatch(options: {
  scrollX: boolean
  scrollY: boolean
  scrollbarOptions: unknown
  horizontalScrollbarOptions: unknown
  verticalScrollbarOptions: unknown
}) {
  return (
    needsAxisPatch(options.scrollX, options.scrollbarOptions, options.horizontalScrollbarOptions) &&
    needsAxisPatch(options.scrollY, options.scrollbarOptions, options.verticalScrollbarOptions)
  )
}

export function installCoupledOverflowPatch(node: ScrollBoxRenderable) {
  const box = node as unknown as Box
  if (box.__oriCoupledOverflowPatch) return

  const getPatch = () => {
    const patch = box.__oriCoupledOverflowPatch
    if (patch) return patch

    const next = {
      x: node.horizontalScrollBar.visible,
      y: node.verticalScrollBar.visible,
      w: node.viewport.width,
      h: node.viewport.height,
    }
    box.__oriCoupledOverflowPatch = next
    return next
  }
  const getThickness = (axis: "x" | "y") => {
    const size = axis === "x" ? node.verticalScrollBar.width : node.horizontalScrollBar.height
    if (size > 0) return size
    return 1
  }
  const getViewport = (axis: "x" | "y") => {
    const patch = getPatch()
    if (axis === "x") return Math.max(0, patch.w - (patch.y ? getThickness("x") : 0))
    return Math.max(0, patch.h - (patch.x ? getThickness("y") : 0))
  }
  const patchAxis = (key: "scrollTop" | "scrollLeft") => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), key)
    const get = descriptor?.get
    const set = descriptor?.set
    if (!get || !set) return

    Object.defineProperty(node, key, {
      configurable: true,
      get() {
        return get.call(this)
      },
      set(value: number) {
        const viewport = key === "scrollTop" ? getViewport("y") : getViewport("x")
        const scroll = key === "scrollTop" ? node.scrollHeight : node.scrollWidth
        const max = Math.max(0, scroll - viewport)
        set.call(this, Math.min(Math.max(0, value), max))
      },
    })
  }

  const recalculate = box.recalculateBarProps.bind(node)
  patchAxis("scrollTop")
  patchAxis("scrollLeft")
  getPatch()

  box.recalculateBarProps = () => {
    const patch = getPatch()
    patch.w = node.viewport.width + (patch.y ? getThickness("x") : 0)
    patch.h = node.viewport.height + (patch.x ? getThickness("y") : 0)
    patch.x = node.content.width > patch.w
    patch.y = node.content.height > patch.h

    node.horizontalScrollBar.visible = patch.x
    node.verticalScrollBar.visible = patch.y
    recalculate()

    if (!patch.x) node.scrollLeft = 0
    if (!patch.y) node.scrollTop = 0
  }

  process.nextTick(box.recalculateBarProps)
}

function needsAxisPatch(enabled: boolean, shared: unknown, specific: unknown) {
  if (!enabled) return false
  if (resolveVisibility(specific) !== undefined) return false
  if (resolveVisibility(shared) !== undefined) return false
  return true
}

function resolveVisibility(options: unknown) {
  if (!options || typeof options !== "object") return undefined
  return (options as ScrollbarOptions).visible
}
