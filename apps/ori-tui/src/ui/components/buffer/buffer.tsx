import type { LineNumberRenderable, TextareaRenderable } from "@opentui/core"
import { OriScrollbox } from "@ui/components/ori-scrollbox"
import { SelectPopup } from "@ui/components/select-popup"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import {
  type BufferApi,
  type BufferCursor,
  type BufferProps,
  type BufferState,
  createBufferController,
} from "./buffer-controller"

export type { BufferApi, BufferCursor, BufferProps, BufferState }

export function Buffer(props: BufferProps) {
  const { theme } = useTheme()
  const controller = createBufferController(props, theme)
  const background = () => theme().get("editor_background")
  const viewportHeight = controller.layout.viewportHeight
  const totalRows = controller.layout.totalRows
  const bindings: KeyBinding[] = [
    {
      pattern: "escape",
      handler: controller.commands.escape,
      preventDefault: true,
    },
    {
      pattern: "ctrl+u",
      handler: () => {
        controller.commands.deleteToLineStart()
      },
      preventDefault: true,
    },
  ]

  return (
    <KeyScope
      bindings={bindings}
      enabled={props.isFocused}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: root terminates drag selection when release lands outside textarea */}
      <box
        ref={controller.refs.attachRoot}
        position="relative"
        flexDirection="column"
        flexGrow={1}
        backgroundColor={background()}
        onMouseUp={controller.root.handleMouseUp}
        onMouseDragEnd={controller.root.handleMouseDragEnd}
      >
        <OriScrollbox
          marginTop={1}
          stickyScroll={false}
          scrollX={false}
          onReady={controller.refs.attachScrollbox}
          onSync={controller.scrollbox.handleStateChange}
          onUserScroll={controller.scrollbox.handleUserScroll}
          height="100%"
          horizontalScrollbarOptions={{
            trackOptions: {
              backgroundColor: background(),
            },
          }}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: background(),
            },
          }}
          minVerticalThumbHeight={2}
        >
          <box
            position="relative"
            flexDirection="column"
            backgroundColor={background()}
            width="100%"
          >
            <box
              height={totalRows()}
              minHeight={totalRows()}
              maxHeight={totalRows()}
            />
            <line_number
              ref={(node: LineNumberRenderable | undefined) => {
                controller.refs.attachGutter(node)
              }}
              position="absolute"
              top={0}
              left={0}
              width="100%"
              height={viewportHeight()}
              minHeight={viewportHeight()}
              maxHeight={viewportHeight()}
              fg={theme().get("text_muted")}
              bg={background()}
              paddingRight={1}
              minWidth={5}
            >
              <textarea
                ref={(node: TextareaRenderable | undefined) => {
                  controller.refs.attachTextarea(node)
                }}
                height={viewportHeight()}
                minHeight={viewportHeight()}
                maxHeight={viewportHeight()}
                width="100%"
                flexGrow={1}
                flexShrink={1}
                initialValue={controller.document.doc().text}
                textColor={theme().get("editor_text")}
                focusedTextColor={theme().get("editor_text")}
                backgroundColor="transparent"
                focusedBackgroundColor="transparent"
                cursorColor={theme().get("editor_cursor")}
                wrapMode="char"
                selectable={true}
                keyBindings={[]}
                onMouseDown={controller.textarea.handleMouseDown}
                onMouseScroll={controller.textarea.handleMouseScroll}
                onCursorChange={controller.textarea.handleCursorChange}
                onContentChange={controller.textarea.handleContentChange}
              />
            </line_number>
          </box>
        </OriScrollbox>
        <SelectPopup viewModel={controller.autocomplete.viewModel} />
      </box>
    </KeyScope>
  )
}
