import { type LineNumberOptions, LineNumberRenderable, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"

const BUFFER_LINE_NUMBER_MIN_WIDTH = 5

export class BufferLineNumberRenderable extends LineNumberRenderable {
  constructor(ctx: RenderContext, options: LineNumberOptions) {
    super(ctx, {
      ...options,
      minWidth: options.minWidth ?? BUFFER_LINE_NUMBER_MIN_WIDTH,
    })
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
