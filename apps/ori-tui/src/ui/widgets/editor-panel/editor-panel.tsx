import { Buffer, type BufferContext } from "@ui/components/buffer"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { useStatusline } from "@ui/widgets/statusline/statusline-context"
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createSqlSupport } from "./sql-support"
import type { EditorPaneViewModel } from "./view-model/create-vm"

const EMPTY_MARKERS = new Map<number, string>()

export type EditorPanelProps = {
  viewModel: EditorPaneViewModel
}

export function EditorPanel(props: EditorPanelProps) {
  const pane = props.viewModel
  const logger = useLogger()
  const statusline = useStatusline()
  const { theme } = useTheme()
  const [bufferContext, setBufferContext] = createSignal<BufferContext>()
  const cursorLine = createMemo(() => bufferContext()?.focusedRow ?? -1)
  const hasCursor = createMemo(() => bufferContext()?.cursorOffset !== undefined)
  const support = createSqlSupport({
    theme,
    logger,
    getSchemaState: pane.getSchemaState,
  })

  onCleanup(() => {
    support.dispose()
  })

  onMount(() => {
    statusline.fileOpenedInBuffer(pane.filePath())
  })

  const baseGutterMarkers = createMemo(() => {
    const analysis = support.snapshot()
    if (!analysis || analysis.queries.length < 2) {
      return EMPTY_MARKERS
    }

    return new Map(analysis.queries.map((query) => [query.startLine, "• "]))
  })

  const activeMarkerLine = createMemo(() => {
    const analysis = support.snapshot()
    if (!analysis || !hasCursor()) {
      return -1
    }

    const line = cursorLine()
    return analysis.queryStartLineByLine[line] ?? -1
  })

  const gutterMarkers = createMemo(() => {
    const markers = baseGutterMarkers()
    const activeLine = activeMarkerLine()
    if (markers.size === 0 || activeLine < 0) {
      return markers
    }

    const next = new Map(markers)
    next.set(activeLine, "󰻃 ")
    return next
  })

  const handleContextChange = (context: BufferContext) => {
    setBufferContext(context)
  }

  const handleTextChange = (text: string, info: { modified: boolean }) => {
    if (info.modified) {
      pane.onQueryChange(text)
      return
    }
  }

  const handleUnfocus = () => {
    pane.unfocus()
  }

  const keyBindings: KeyBinding[] = [
    {
      pattern: "enter",
      mode: "leader",
      description: "Execute query",
      handler: () => {
        const context = bufferContext()
        void pane.executeQuery(context?.cursorOffset, support.snapshot())
      },
      preventDefault: true,
      commandPaletteSection: "Query",
    },
  ]

  return (
    <KeyScope
      bindings={keyBindings}
      enabled={pane.isFocused}
    >
      <box
        flexDirection="column"
        minHeight={3}
        marginRight={1}
        marginLeft={1}
        backgroundColor={theme().get("editor_background")}
      >
        <Buffer
          initialText={pane.queryText()}
          isFocused={pane.isFocused}
          onTextChange={handleTextChange}
          onUnfocus={handleUnfocus}
          focusSelf={pane.focusSelf}
          onContextChange={handleContextChange}
          gutterMarkers={gutterMarkers}
          autocomplete={support.autocomplete}
          analysis={support.analysis}
        />
      </box>
    </KeyScope>
  )
}
