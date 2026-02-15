import {
  type OptimizedBuffer,
  parseColor,
  Renderable,
  type RenderableOptions,
  type RenderContext,
  type RGBA,
} from "@opentui/core"
import { extend } from "@opentui/solid"

/* We have a custom renderable because the more straightforward approach (just using the
 * native JSX building blocks) forces extremely heavy width computations we can't afford
 * when dealing with 1000s of columns */

export type TreeRowSegment = {
  text: string
  fg?: string
  bg?: string
  attributes?: number
}

export type TreeRowRenderableOptions = RenderableOptions<TreeRowRenderable> & {
  segments: TreeRowSegment[]
  width: number
  defaultFg: string
  fg?: string
  bg?: string
}

type ParsedSegment = {
  text: string
  fg: RGBA
  bg?: RGBA
  attributes?: number
}

const normalizeColor = (value: string | undefined, fallback?: RGBA) => {
  if (!value) return fallback
  return parseColor(value)
}

export class TreeRowRenderable extends Renderable {
  private parsedSegments: ParsedSegment[] = []
  private rawSegments: TreeRowSegment[] = []
  private fallbackFg: RGBA
  private fallbackBg: RGBA | undefined

  constructor(ctx: RenderContext, options: TreeRowRenderableOptions) {
    const { segments, fg, bg, width, defaultFg, ...renderableOptions } = options
    super(ctx, {
      height: 1,
      flexShrink: 0,
      buffered: true,
      ...renderableOptions,
      width: Math.max(1, width),
    })
    this.fallbackFg = parseColor(defaultFg)
    this.fallbackFg = normalizeColor(fg, this.fallbackFg) ?? this.fallbackFg
    this.fallbackBg = normalizeColor(bg)
    this.setSegments(segments, true)
  }

  set segments(segments: TreeRowSegment[]) {
    this.setSegments(segments)
  }

  get segments() {
    return this.rawSegments
  }

  set fg(value: string | undefined) {
    this.fallbackFg = normalizeColor(value, this.fallbackFg) ?? this.fallbackFg
    this.setSegments(this.rawSegments, true)
  }

  set bg(value: string | undefined) {
    this.fallbackBg = normalizeColor(value)
    this.setSegments(this.rawSegments, true)
  }

  private setSegments(segments: TreeRowSegment[], requestRender = true) {
    this.rawSegments = segments ?? []
    this.parsedSegments = this.rawSegments.map((segment) => ({
      text: segment.text,
      fg: normalizeColor(segment.fg, this.fallbackFg) ?? this.fallbackFg,
      bg: normalizeColor(segment.bg, this.fallbackBg),
      attributes: segment.attributes,
    }))
    if (requestRender) this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer) {
    let cursorX = 0
    for (const segment of this.parsedSegments) {
      if (!segment.text || segment.text.length === 0) continue
      buffer.drawText(segment.text, cursorX, 0, segment.fg ?? this.fallbackFg, segment.bg, segment.attributes)
      cursorX += segment.text.length
    }
  }
}

extend({ tree_row: TreeRowRenderable })

declare global {
  namespace JSX {
    interface IntrinsicElements {
      tree_row: TreeRowRenderableOptions
    }
  }
}
