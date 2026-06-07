import { type LineNumberOptions, LineNumberRenderable, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

const BUFFER_LINE_NUMBER_MIN_WIDTH = 5
const BUFFER_LINE_NUMBER_TARGET_RIGHT_GAP = 1

type InternalLineNumberRenderable = LineNumberRenderable & {
  gutter?: {
    width: number
    visible: boolean
  }
  target?: {
    isDestroyed?: boolean
    position: "absolute" | "relative"
    left: number | "auto" | `${number}%` | undefined
    top: number | "auto" | `${number}%` | undefined
    width: number
    height: number
    minWidth: number | `${number}%` | null | undefined
    maxWidth: number | `${number}%` | null | undefined
    minHeight: number | `${number}%` | null | undefined
    maxHeight: number | `${number}%` | null | undefined
    flexGrow: number | null | undefined
    flexShrink: number | null | undefined
  }
}

export class BufferLineNumberRenderable extends LineNumberRenderable {
  constructor(ctx: RenderContext, options: LineNumberOptions) {
    super(ctx, {
      ...options,
      minWidth: options.minWidth ?? BUFFER_LINE_NUMBER_MIN_WIDTH,
    })
  }

  protected override renderSelf(buffer: Parameters<LineNumberRenderable["renderSelf"]>[0]) {
    this.syncTargetLayout()
    super.renderSelf(buffer)
  }

  override onResize(width: number, height: number) {
    super.onResize(width, height)
    this.syncTargetLayout()
  }

  private syncTargetLayout() {
    const node = this as InternalLineNumberRenderable
    const gutter = node.gutter
    const target = node.target
    if (!gutter || !target || target.isDestroyed) {
      return
    }

    const left = gutter.visible ? gutter.width : 0
    const width = Math.max(1, this.width - left - BUFFER_LINE_NUMBER_TARGET_RIGHT_GAP)
    if (
      target.position === "absolute" &&
      target.left === left &&
      target.top === 0 &&
      target.width === width &&
      target.height === this.height
    ) {
      return
    }

    // Keep the textarea geometry explicit instead of relying on nested flex inside
    // LineNumberRenderable; this avoids wrapped continuations drifting under the gutter.
    target.position = "absolute"
    target.left = left
    target.top = 0
    target.width = width
    target.minWidth = width
    target.maxWidth = width
    target.height = this.height
    target.minHeight = this.height
    target.maxHeight = this.height
    target.flexGrow = 0
    target.flexShrink = 0
  }
}

extend({ buffer_line_number: BufferLineNumberRenderable })

declare global {
  namespace JSX {
    interface IntrinsicElements {
      buffer_line_number: LineNumberOptions
    }
  }
}
