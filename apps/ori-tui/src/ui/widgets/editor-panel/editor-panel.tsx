import { Buffer, type BufferAutocompleteProvider, type BufferGutterContext } from "@ui/components/buffer"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { useStatusline } from "@ui/widgets/statusline/statusline-context"
import { onMount } from "solid-js"
import { collectSqlStatements } from "./sql-statement-detector"
import type { EditorPaneViewModel } from "./view-model/create-vm"

export type EditorPanelProps = {
  viewModel: EditorPaneViewModel
}

export function EditorPanel(props: EditorPanelProps) {
  const pane = props.viewModel
  const statusline = useStatusline()
  const { theme } = useTheme()
  const autocomplete: BufferAutocompleteProvider = {
    getCompletions: ({ text, cursorOffset }) => {
      const prefix = text
        .slice(0, cursorOffset)
        .match(/[A-Za-z]+$/)?.[0]
        ?.toLowerCase()
      if (!prefix || !prefix.startsWith("a")) {
        return undefined
      }

      const words = [
        "autocomplete",
        "autobahn",
        "automobile",
        "albuquerque",
        "alphabet",
        "almanac",
        "altitude",
        "anchor",
        "android",
        "anatomy",
        "angular",
        "aperture",
        "asteroid",
        "avalanche",
        "azure",
      ]
      const items = words
        .filter((word) => word.startsWith(prefix))
        .map((word) => ({
          id: word,
          label: word,
          insertText: word,
          detail: `${word.length} chars`,
        }))
      if (items.length === 0) {
        return undefined
      }

      return {
        replaceStart: cursorOffset - prefix.length,
        replaceEnd: cursorOffset,
        items,
      }
    },
  }

  onMount(() => {
    statusline.fileOpenedInBuffer(pane.filePath())
  })

  const buildGutterMarkers = (context: BufferGutterContext) => {
    const statements = collectSqlStatements(context.text, context.lineStarts)
    if (statements.length < 2) {
      return new Map<number, string>()
    }

    const markers = new Map<number, string>()
    const current = statements.find(
      (statement) => statement.startLine <= context.focusedRow && statement.endLine >= context.focusedRow,
    )
    if (current) {
      markers.set(current.startLine, "󰻃 ")
    }
    for (const statement of statements) {
      if (statement.startLine === current?.startLine) {
        continue
      }
      markers.set(statement.startLine, "• ")
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
        void pane.executeQuery()
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
          buildGutterMarkers={buildGutterMarkers}
          autocomplete={autocomplete}
        />
      </box>
    </KeyScope>
  )
}
