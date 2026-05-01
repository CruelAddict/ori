import { Buffer, type BufferApi, type BufferContext } from "@ui/components/buffer"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { useStatusline } from "@ui/widgets/statusline/statusline-context"
import { createMemo, createSignal, onMount } from "solid-js"
import type { EditorPaneViewModel } from "./view-model/create-vm"

const EMPTY_MARKERS = new Map<number, string>()

export type EditorPanelProps = {
  viewModel: EditorPaneViewModel
}

export function EditorPanel(props: EditorPanelProps) {
  const pane = props.viewModel
  const statusline = useStatusline()
  const { theme } = useTheme()
  let bufferApi: BufferApi | undefined
  const [bufferContext, setBufferContext] = createSignal<BufferContext>()
  const cursorLine = createMemo(() => bufferContext()?.focusedRow ?? -1)
  const hasCursor = createMemo(() => bufferContext()?.cursorOffset !== undefined)

  onMount(() => {
    statusline.fileOpenedInBuffer(pane.filePath())
  })

  const baseGutterMarkers = createMemo(() => {
    const analysis = pane.statementAnalysis.current()
    if (!analysis || analysis.queries.length < 2) {
      return EMPTY_MARKERS
    }

    return new Map(analysis.queries.map((query) => [query.startLine, "• "]))
  })

  const activeMarkerLine = createMemo(() => {
    const analysis = pane.statementAnalysis.current()
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
    pane.statementAnalysis.analyze(context.text, context.documentVersion)
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
        void pane.executeQuery(bufferApi?.getCursorOffset())
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
          language="sql"
          isFocused={pane.isFocused}
          onTextChange={handleTextChange}
          onUnfocus={handleUnfocus}
          focusSelf={pane.focusSelf}
          registerApi={(api) => {
            bufferApi = api
          }}
          onContextChange={handleContextChange}
          gutterMarkers={gutterMarkers}
          autocomplete={pane.autocomplete}
        />
      </box>
    </KeyScope>
  )
}
