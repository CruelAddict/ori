import {
  type BoxOptions,
  BoxRenderable,
  type MouseEvent,
  type OptimizedBuffer,
  parseColor,
  type RenderContext,
  type RGBA,
  type Selection,
} from "@opentui/core"
import { extend } from "@opentui/solid"

export type TableCellOptions = BoxOptions & {
  value?: string
  display?: string
  fg?: string
  defaultFg?: string
  attributes?: number
  align?: "left" | "right"
  selectionBg?: string
  paddingLeft?: number
  paddingRight?: number
  selectable?: boolean
  selected?: boolean
  onSelectionChange?: (selected: boolean) => void
  onSelectionUpdate?: (selection: Selection | null) => void
}

export class TableCellRenderable extends BoxRenderable {
  public selectable = true
  private nativeSelected = false
  private forcedSelected: boolean | undefined
  private valueText = ""
  private displayText = ""
  private textColor: RGBA | undefined
  private fallbackTextColor: RGBA | undefined
  private textAttributes: number | undefined
  private alignment: "left" | "right" = "left"
  private paddingLeftValue = 0
  private paddingRightValue = 0
  private selectionColor: RGBA | undefined
  private onSelectionChange?: (selected: boolean) => void
  private onSelectionUpdate?: (selection: Selection | null) => void

  constructor(ctx: RenderContext, options: TableCellOptions) {
    const {
      value,
      display,
      fg,
      defaultFg,
      attributes,
      align,
      selectionBg,
      paddingLeft,
      paddingRight,
      selectable,
      selected,
      onSelectionChange,
      onSelectionUpdate,
      ...renderableOptions
    } = options
    const height = renderableOptions.height ?? 1
    const minHeight = renderableOptions.minHeight ?? 1
    super(ctx, { ...renderableOptions, height, minHeight } as BoxOptions)
    this.value = value ?? ""
    this.display = display
    this.defaultFg = defaultFg
    this.fg = fg
    this.attributes = attributes
    this.align = align
    this.selectionBg = selectionBg
    this.paddingLeft = paddingLeft ?? 1
    this.paddingRight = paddingRight ?? 1
    this.selectable = selectable ?? true
    this.selected = selected
    this.onSelectionChange = onSelectionChange
    this.onSelectionUpdate = onSelectionUpdate
  }

  set value(value: string) {
    if (this.valueText === value) return
    this.valueText = value
  }

  set display(value: string | undefined) {
    const next = value ?? ""
    if (this.displayText === next) return
    this.displayText = next
    this.requestRender()
  }

  set fg(value: string | undefined) {
    const next = value ? parseColor(value) : undefined
    if (this.textColor === next) return
    this.textColor = next
    this.requestRender()
  }

  set defaultFg(value: string | undefined) {
    const next = value ? parseColor(value) : undefined
    if (this.fallbackTextColor === next) return
    this.fallbackTextColor = next
    this.requestRender()
  }

  set attributes(value: number | undefined) {
    if (this.textAttributes === value) return
    this.textAttributes = value
    this.requestRender()
  }

  set align(value: "left" | "right" | undefined) {
    const next = value ?? "left"
    if (this.alignment === next) return
    this.alignment = next
    this.requestRender()
  }

  set selectionBg(value: string | undefined) {
    const next = value ? parseColor(value) : undefined
    if (this.selectionColor === next) return
    this.selectionColor = next
    if (this.hasVisualSelection()) {
      this.requestRender()
    }
  }

  set paddingLeft(value: number | undefined) {
    const next = value ?? 1
    if (this.paddingLeftValue === next) return
    this.paddingLeftValue = next
    this.requestRender()
  }

  set paddingRight(value: number | undefined) {
    const next = value ?? 1
    if (this.paddingRightValue === next) return
    this.paddingRightValue = next
    this.requestRender()
  }

  set selected(value: boolean | undefined) {
    if (this.forcedSelected === value) return
    const prev = this.hasVisualSelection()
    this.forcedSelected = value
    if (prev !== this.hasVisualSelection()) {
      this.requestRender()
    }
  }

  set bg(value: string | RGBA | undefined) {
    if (value === undefined) {
      this.backgroundColor = "transparent"
      return
    }
    this.backgroundColor = value
  }

  shouldStartSelection(x: number, y: number) {
    return x >= this.x && x < this.x + this.width && y >= this.y && y < this.y + this.height
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (event.type !== "up") {
      return
    }

    const selection = this.ctx.getSelection()
    if (!selection?.isStart) {
      return
    }

    this.ctx.clearSelection()
  }

  onSelectionChanged(selection: Selection | null) {
    this.onSelectionUpdate?.(selection)

    if (!selection?.isActive) {
      const prev = this.hasVisualSelection()
      this.nativeSelected = false
      if (prev !== this.hasVisualSelection()) {
        this.requestRender()
      }
      this.onSelectionChange?.(false)
      return false
    }

    const bounds = selection.bounds
    const overlaps =
      bounds.x < this.x + this.width &&
      bounds.x + bounds.width > this.x &&
      bounds.y < this.y + this.height &&
      bounds.y + bounds.height > this.y
    const prev = this.hasVisualSelection()
    const changed = this.nativeSelected !== overlaps
    this.nativeSelected = overlaps
    if (prev !== this.hasVisualSelection()) {
      this.requestRender()
    }
    if (changed) {
      this.onSelectionChange?.(overlaps)
    }
    return overlaps
  }

  getSelectedText() {
    if (!this.nativeSelected) return ""
    if (this.valueText.length === 0) return ""
    return this.valueText
  }

  hasSelection() {
    return this.hasVisualSelection()
  }

  private hasVisualSelection() {
    return this.forcedSelected ?? this.nativeSelected
  }

  protected renderSelf(buffer: OptimizedBuffer) {
    const backgroundColor =
      this.hasVisualSelection() && this.selectionColor ? this.selectionColor : this._backgroundColor
    const borderColor = this._focused ? this._focusedBorderColor : this._borderColor
    buffer.drawBox({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      borderStyle: this._borderStyle,
      customBorderChars: this._customBorderChars,
      border: this._border,
      borderColor,
      backgroundColor,
      shouldFill: this.shouldFill,
      title: this._title,
      titleAlignment: this._titleAlignment,
    })

    const contentWidth = Math.max(0, this.width - this.paddingLeftValue - this.paddingRightValue)
    if (contentWidth <= 0) return

    const trimmed = this.displayText.length > contentWidth ? this.displayText.slice(0, contentWidth) : this.displayText
    const padTotal = Math.max(0, contentWidth - trimmed.length)
    const padLeft = this.alignment === "right" ? padTotal : 0
    const padRight = this.alignment === "right" ? 0 : padTotal
    const text = `${" ".repeat(padLeft)}${trimmed}${" ".repeat(padRight)}`

    const startX = this.x + this.paddingLeftValue
    if (startX >= buffer.width) return

    const hiddenLeft = Math.max(0, -startX)
    if (hiddenLeft >= text.length) return

    const drawX = Math.max(0, startX)
    const maxVisible = buffer.width - drawX
    if (maxVisible <= 0) return

    const clippedLeft = text.slice(hiddenLeft)
    if (clippedLeft.length === 0) return

    const visibleText = clippedLeft.length > maxVisible ? clippedLeft.slice(0, maxVisible) : clippedLeft
    if (visibleText.length === 0) return

    const textColor = this.textColor ?? this.fallbackTextColor
    if (!textColor) return

    buffer.drawText(visibleText, drawX, this.y, textColor, backgroundColor, this.textAttributes)
  }
}

extend({ table_cell: TableCellRenderable })

declare global {
  namespace JSX {
    interface IntrinsicElements {
      table_cell: TableCellOptions
    }
  }
}
