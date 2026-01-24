import { useTheme } from "@app/providers/theme"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import type { EditorPaneViewModel } from "@src/features/editor-pane/use-editor-pane"
import { useStatusline } from "@src/widgets/statusline/statusline-context"
import { onMount, Show } from "solid-js"
import { Buffer } from "./buffer"

export type EditorPanelProps = {
  viewModel: EditorPaneViewModel
}

export function EditorPanel(props: EditorPanelProps) {
  const pane = props.viewModel
  const statusline = useStatusline()

  onMount(() => {
    statusline.fileOpenedInBuffer(pane.filePath())
  })

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
        backgroundColor={useTheme().theme().editorBackground}
      >
        <Buffer
          initialText={pane.queryText()}
          isFocused={pane.isFocused}
          onTextChange={handleTextChange}
          onUnfocus={handleUnfocus}
          focusSelf={pane.focusSelf}
        />
      </box>
    </KeyScope>
  )
}
