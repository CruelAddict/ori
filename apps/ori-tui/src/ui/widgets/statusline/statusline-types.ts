import type { JustifyString } from "@opentui/core"
import type { AppContextValue } from "@ui/providers/app-context"
import type { HighlightGroup } from "@ui/theme"
import type { Accessor, JSX, ParentProps } from "solid-js"

export type StatuslineContext = {
  app: AppContextValue
  now: Accessor<number>
  color: (value: HighlightGroup) => string
  Text: (props: ParentProps<{ color?: HighlightGroup }>) => JSX.Element
}

export type StatuslinePlugin = {
  visible?: (ctx: StatuslineContext) => boolean
  render: (ctx: StatuslineContext) => JSX.Element
}

export type StatuslineSlot = StatuslinePlugin[]
export type StatuslineNode = StatuslinePlugin | StatuslineSlot | StatuslineGroup

export type StatuslineGroup = {
  children: StatuslineNode[]
  justifyContent?: JustifyString
  gap?: number
}
