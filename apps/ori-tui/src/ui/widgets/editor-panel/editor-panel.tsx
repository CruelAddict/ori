import { Buffer, type BufferState } from "@ui/components/buffer"
import { useLogger } from "@ui/providers/logger"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { useStatusline } from "@ui/widgets/statusline/statusline-context"
import { createSignal, onCleanup, onMount } from "solid-js"
import { createSqlSupport } from "./sql-support"
import type { EditorPaneViewModel } from "./view-model/create-vm"

export type EditorPanelProps = {
  viewModel: EditorPaneViewModel
}

export function EditorPanel(props: EditorPanelProps) {
  const pane = props.viewModel
  const logger = useLogger()
  const statusline = useStatusline()
  const { theme } = useTheme()
  const [bufferState, setBufferState] = createSignal<BufferState>()
  const support = createSqlSupport({
    theme,
    logger,
    getSchemaState: pane.getSchemaState,
    subscribeSchemaState: pane.subscribeSchemaState,
  })

  onCleanup(() => {
    support.dispose()
  })

  onMount(() => {
    statusline.fileOpenedInBuffer(pane.filePath())
  })

  const handleStateChange = (state: BufferState) => {
    setBufferState(state)
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
        void pane.executeQuery(bufferState()?.cursor?.offset, support.snapshot())
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
          onStateChange={handleStateChange}
          autocomplete={support.autocomplete}
          extensions={support.extensions}
        />
      </box>
    </KeyScope>
  )
}
