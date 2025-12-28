import { useLogger } from "@app/providers/logger";
import { useTheme } from "@app/providers/theme";
import type { KeyEvent, MouseEvent, TextareaRenderable } from "@opentui/core";
import { RGBA, SyntaxStyle } from "@opentui/core";
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes";
import { type Accessor, createEffect, For, onCleanup, onMount, Show } from "solid-js";
import { type BufferModel, type CursorContext, createBufferModel } from "./buffer-model";

const BUFFER_SCOPE_ID = "connection-view.buffer";
const DEBOUNCE_MS = 200;

export type BufferApi = {
  setText: (text: string) => void;
  focus: () => void;
};

export type BufferProps = {
  initialText: string;
  isFocused: Accessor<boolean>;
  onTextChange: (text: string, info: { modified: boolean }) => void;
  onUnfocus?: () => void;
  registerApi?: (api: BufferApi) => void;
};

function createBufferBindings(bufferModel: BufferModel, props: BufferProps): KeyBinding[] {
  const withCursor = (handler: (ctx: CursorContext, event: KeyEvent) => void) => (event: KeyEvent) => {
    const ctx = bufferModel.getCursorContext();
    if (!ctx) {
      return;
    }
    handler(ctx, event);
  };

  return [
    {
      pattern: "escape",
      handler: () => {
        bufferModel.flush();
        props.onUnfocus?.();
      },
      preventDefault: true,
    },
    {
      pattern: "return",
      handler: withCursor((ctx, event) => {
        event.preventDefault();
        bufferModel.handleEnter(ctx.index);
      }),
    },
    {
      pattern: "up",
      handler: withCursor((ctx, event) => {
        event.preventDefault();
        bufferModel.setNavColumn(ctx.cursorCol);
        bufferModel.handleVerticalMove(ctx.index, -1);
      }),
    },
    {
      pattern: "down",
      handler: withCursor((ctx, event) => {
        event.preventDefault();
        bufferModel.setNavColumn(ctx.cursorCol);
        bufferModel.handleVerticalMove(ctx.index, 1);
      }),
    },
    {
      pattern: "left",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
        if (atStart) {
          event.preventDefault();
          bufferModel.handleHorizontalJump(ctx.index, true);
        }
      }),
    },
    {
      pattern: "right",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
        if (atEnd) {
          event.preventDefault();
          bufferModel.handleHorizontalJump(ctx.index, false);
        }
      }),
    },
    {
      pattern: "backspace",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
        if (atStart) {
          event.preventDefault();
          bufferModel.handleBackwardMerge(ctx.index);
        }
      }),
    },
    {
      pattern: "delete",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
        if (atEnd) {
          event.preventDefault();
          bufferModel.handleForwardMerge(ctx.index);
        }
      }),
    },
    {
      pattern: "ctrl+h",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
        if (atStart) {
          event.preventDefault();
          bufferModel.handleBackwardMerge(ctx.index);
        }
      }),
    },
    {
      pattern: "ctrl+w",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atStart = ctx.cursorCol === 0 && ctx.cursorRow === 0;
        if (atStart) {
          event.preventDefault();
          bufferModel.handleBackwardMerge(ctx.index);
        }
      }),
    },
    {
      pattern: "ctrl+d",
      handler: withCursor((ctx, event) => {
        bufferModel.setNavColumn(ctx.cursorCol);
        const atEnd = ctx.cursorCol === ctx.text.length && ctx.cursorRow === 0;
        if (atEnd) {
          event.preventDefault();
          bufferModel.handleForwardMerge(ctx.index);
        }
      }),
    },
  ];
}

export function Buffer(props: BufferProps) {
  const { theme } = useTheme();
  const palette = theme;
  const logger = useLogger();

  const syntaxStyle = SyntaxStyle.create();
  // TODO: make reactive
  const p = palette();
  syntaxStyle.registerStyle("syntax.keyword", { fg: RGBA.fromHex(p.primary) });
  syntaxStyle.registerStyle("syntax.string", { fg: RGBA.fromHex(p.accent) });
  syntaxStyle.registerStyle("syntax.number", { fg: RGBA.fromHex(p.info) });
  syntaxStyle.registerStyle("syntax.comment", { fg: RGBA.fromHex(p.textMuted) });
  syntaxStyle.registerStyle("syntax.identifier", { fg: RGBA.fromHex(p.text) });
  syntaxStyle.registerStyle("syntax.operator", { fg: RGBA.fromHex(p.secondary) });

  const bufferModel = createBufferModel({
    initialText: props.initialText,
    isFocused: props.isFocused,
    onTextChange: props.onTextChange,
    debounceMs: DEBOUNCE_MS,
    syntaxStyle,
  });

  const focus = () => {
    bufferModel.focusCurrent();
  };

  const setText = (text: string) => {
    bufferModel.setText(text);
  };

  onMount(() => {
    const api: BufferApi = { setText, focus };
    props.registerApi?.(api);
  });

  onCleanup(() => {
    bufferModel.dispose();
    syntaxStyle.destroy();
  });

  const handleMouseDown = (index: number, event: MouseEvent) => {
    event.target?.focus();
    bufferModel.setFocusedRow(index);
  };

  const bindings = createBufferBindings(bufferModel, props);

  createEffect(() => {
    bufferModel.handleFocusChange(props.isFocused());
  });

  return (
    <KeyScope
      id={BUFFER_SCOPE_ID}
      bindings={bindings}
      enabled={props.isFocused}
    >
      <scrollbox height={"100%"}>
        <box
          flexDirection="column"
          paddingTop={1}
        >
          <For each={bufferModel.lines()}>
            {(line, indexAccessor) => {
              return (
                <box flexDirection="row">
                  <box
                    flexDirection="row"
                    minWidth={3}
                    justifyContent="flex-end"
                    alignItems="flex-start"
                    marginRight={1}
                  >
                    <text
                      maxHeight={1}
                      fg={palette().textMuted}
                    >
                      {indexAccessor() + 1}
                    </text>
                  </box>
                  <textarea
                    ref={(renderable: TextareaRenderable | undefined) => {
                      bufferModel.setLineRef(line.id, renderable);
                    }}
                    textColor={palette().editorText}
                    focusedTextColor={palette().editorText}
                    cursorColor={palette().primary}
                    syntaxStyle={syntaxStyle}
                    selectable={true}
                    keyBindings={[]}
                    onMouseDown={(event: MouseEvent) => {
                      handleMouseDown(indexAccessor(), event);
                    }}
                    onContentChange={() => bufferModel.handleTextAreaChange(indexAccessor())}
                    initialValue={line.text}
                  />
                </box>
              );
            }}
          </For>
          <Show when={bufferModel.lines().length === 0}>
            <text fg={palette().editorText}> </text>
          </Show>
        </box>
      </scrollbox>
    </KeyScope>
  );
}
