import { Buffer, type BufferApi, type BufferGutterContext } from "@ui/components/buffer"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { useStatusline } from "@ui/widgets/statusline/statusline-context"
import { onMount } from "solid-js"
import { collectSqlQueries, resolveSqlQueryAtOffset } from "./sql-statement-detector"
import type { EditorPaneViewModel } from "./view-model/create-vm"

export type EditorPanelProps = {
  viewModel: EditorPaneViewModel
}

export function EditorPanel(props: EditorPanelProps) {
  const pane = props.viewModel
  const statusline = useStatusline()
  const { theme } = useTheme()
  let bufferApi: BufferApi | undefined

  onMount(() => {
    statusline.fileOpenedInBuffer(pane.filePath())
  })

  const buildGutterMarkers = (context: BufferGutterContext) => {
    const queries = collectSqlQueries(context.text, context.lineStarts)
    if (queries.length < 2) {
      return new Map<number, string>()
    }

    const markers = new Map<number, string>()
    const current =
      context.cursorOffset === undefined
        ? undefined
        : (() => {
            const resolution = resolveSqlQueryAtOffset(context.text, context.lineStarts, context.cursorOffset)
            if (resolution.kind !== "query") {
              return undefined
            }
            return resolution.query
          })()
    if (current) {
      markers.set(current.startLine, "󰻃 ")
    }
    for (const query of queries) {
      if (query.startLine === current?.startLine) {
        continue
      }
      markers.set(query.startLine, "• ")
    }
    return markers
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
          buildGutterMarkers={buildGutterMarkers}
          autocomplete={pane.autocomplete}
        />
      </box>
    </KeyScope>
  )
}
