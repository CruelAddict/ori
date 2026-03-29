import type { OptimizedBuffer, RGBA, ScrollBoxRenderable } from "@opentui/core"

type ScrollbarCharSet = {
  full: string
  start: string
  end: string
}

type SliderWithBraillePatch = {
  __brailleScrollbarPatch?: boolean
  orientation?: "vertical" | "horizontal"
  x?: number
  y?: number
  width?: number
  height?: number
  _backgroundColor?: RGBA
  _foregroundColor?: RGBA
  getVirtualThumbSize?: () => number
  getVirtualThumbStart?: () => number
  renderSelf?: (buffer: OptimizedBuffer) => void
  requestRender?: () => void
}

const brailleScrollbarChars: Record<"horizontal" | "vertical", ScrollbarCharSet> = {
  horizontal: {
    full: "⠶",
    start: "⠆",
    end: "⠰",
  },
  vertical: {
    full: "⣿",
    start: "⠛",
    end: "⣤",
  },
}

export function patchBrailleScrollbarThumbs(scrollBox: ScrollBoxRenderable | undefined) {
  if (!scrollBox) return

  patchBrailleScrollbarSlider(scrollBox.horizontalScrollBar?.slider as unknown as SliderWithBraillePatch | undefined)
  patchBrailleScrollbarSlider(scrollBox.verticalScrollBar?.slider as unknown as SliderWithBraillePatch | undefined)
}

function patchBrailleScrollbarSlider(slider: SliderWithBraillePatch | undefined) {
  if (!slider) return
  if (slider.__brailleScrollbarPatch) return

  const original = slider.renderSelf?.bind(slider)
  if (!original) return

  slider.__brailleScrollbarPatch = true
  slider.renderSelf = (buffer: OptimizedBuffer) => {
    const orientation = slider.orientation
    const fg = slider._foregroundColor
    const bg = slider._backgroundColor
    const x = slider.x ?? 0
    const y = slider.y ?? 0
    const width = slider.width ?? 0
    const height = slider.height ?? 0

    if (!orientation || !fg || !bg || width <= 0 || height <= 0) {
      original(buffer)
      return
    }

    const getVirtualThumbSize = slider.getVirtualThumbSize?.bind(slider)
    const getVirtualThumbStart = slider.getVirtualThumbStart?.bind(slider)
    if (!getVirtualThumbSize || !getVirtualThumbStart) {
      original(buffer)
      return
    }

    const chars = brailleScrollbarChars[orientation]
    const virtualThumbSize = getVirtualThumbSize()
    const virtualThumbStart = getVirtualThumbStart()
    const virtualThumbEnd = virtualThumbStart + virtualThumbSize

    buffer.fillRect(x, y, width, height, bg)

    if (orientation === "horizontal") {
      const realStartCell = Math.floor(virtualThumbStart / 2)
      const realEndCell = Math.ceil(virtualThumbEnd / 2) - 1
      const startX = Math.max(0, realStartCell)
      const endX = Math.min(width - 1, realEndCell)

      for (let realX = startX; realX <= endX; realX++) {
        const virtualCellStart = realX * 2
        const virtualCellEnd = virtualCellStart + 2
        const thumbStartInCell = Math.max(virtualThumbStart, virtualCellStart)
        const thumbEndInCell = Math.min(virtualThumbEnd, virtualCellEnd)
        const coverage = thumbEndInCell - thumbStartInCell

        let char = chars.full
        if (coverage < 2) {
          char = thumbStartInCell === virtualCellStart ? chars.start : chars.end
        }

        for (let y2 = 0; y2 < height; y2++) {
          buffer.setCellWithAlphaBlending(x + realX, y + y2, char, fg, bg)
        }
      }

      return
    }

    const realStartCell = Math.floor(virtualThumbStart / 2)
    const realEndCell = Math.ceil(virtualThumbEnd / 2) - 1
    const startY = Math.max(0, realStartCell)
    const endY = Math.min(height - 1, realEndCell)

    for (let realY = startY; realY <= endY; realY++) {
      const virtualCellStart = realY * 2
      const virtualCellEnd = virtualCellStart + 2
      const thumbStartInCell = Math.max(virtualThumbStart, virtualCellStart)
      const thumbEndInCell = Math.min(virtualThumbEnd, virtualCellEnd)
      const coverage = thumbEndInCell - thumbStartInCell
      if (coverage <= 0) continue

      let char = chars.full
      if (coverage < 2) {
        char = thumbStartInCell === virtualCellStart ? chars.start : chars.end
      }

      for (let x2 = 0; x2 < width; x2++) {
        buffer.setCellWithAlphaBlending(x + x2, y + realY, char, fg, bg)
      }
    }
  }

  slider.requestRender?.()
}
