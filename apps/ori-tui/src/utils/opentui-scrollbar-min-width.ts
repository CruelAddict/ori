import type { ScrollBoxRenderable } from "@opentui/core"

type SliderWithMinThumbPatch = {
  __minThumbSizePatch?: {
    minWidth: number
    getVirtualThumbSize: () => number
  }
  getVirtualThumbSize?: () => number
}

export function enforceHorizontalScrollbarMinThumbWidth(scrollBox: ScrollBoxRenderable | undefined, minWidth: number) {
  if (!scrollBox || !Number.isFinite(minWidth) || minWidth <= 0) return

  const slider = scrollBox.horizontalScrollBar?.slider as unknown as SliderWithMinThumbPatch | undefined
  if (!slider) return

  if (slider.__minThumbSizePatch?.minWidth === minWidth) return

  const original = slider.__minThumbSizePatch?.getVirtualThumbSize ?? slider.getVirtualThumbSize?.bind(slider)

  if (!original) return

  slider.__minThumbSizePatch = { minWidth, getVirtualThumbSize: original }

  const minVirtual = Math.max(1, Math.round(minWidth * 2))
  slider.getVirtualThumbSize = () => {
    const orientation = (slider as unknown as { orientation?: "vertical" | "horizontal" }).orientation
    const width = (slider as unknown as { width?: number }).width ?? 0
    const height = (slider as unknown as { height?: number }).height ?? 0
    const trackSize = orientation === "vertical" ? height * 2 : width * 2
    const boundedMin = trackSize > 0 ? Math.min(minVirtual, trackSize) : minVirtual
    return Math.max(original(), boundedMin)
  }

  scrollBox.requestRender()
}

export function enforceStableScrollboxOverflowLayout(scrollBox: ScrollBoxRenderable | undefined) {
  if (!scrollBox) return

  scrollBox.verticalScrollBar.flexShrink = 0
  scrollBox.verticalScrollBar.minWidth = 1
  scrollBox.horizontalScrollBar.flexShrink = 0
  scrollBox.horizontalScrollBar.minHeight = 1

  scrollBox.requestRender()
}
