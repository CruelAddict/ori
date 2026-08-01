import { CliRenderEvents } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { useLogger } from "@ui/providers/logger"
import { copyTextToClipboard } from "@utils/clipboard"
import { onCleanup, onMount } from "solid-js"
import { type SelectionSource, useActiveSelectionOwner } from "./selection-lock"

type RendererWithConsoleSelection = {
  console?: {
    onCopySelection?: (text: string) => void | Promise<void>
  }
}

export type SelectedValue = {
  source: SelectionSource
  text: string
}

type SelectionControllerOptions = {
  onSelected?: (value: SelectedValue) => void | Promise<void>
}

export function useSelectionController(options: SelectionControllerOptions = {}) {
  const selection = useActiveSelectionOwner()
  const renderer = useRenderer()
  const logger = useLogger()
  let settling = false

  const readSelectedText = (text?: string) => text ?? renderer.getSelection?.()?.getSelectedText?.()

  const clearNativeSelection = () => {
    try {
      renderer.clearSelection?.()
    } catch (err) {
      logger.warn({ err }, "selection: failed to clear native selection")
    }
  }

  const handleSelected = (value: SelectedValue) => {
    if (options.onSelected) {
      return options.onSelected(value)
    }

    return copyTextToClipboard(value.text, { renderer, logger })
  }

  const settleSelection = async (source: SelectionSource, text?: string) => {
    if (settling) {
      return
    }

    settling = true
    const active = selection.active()
    try {
      const snapshot = { source, text: readSelectedText(text) }
      if (source === "console-copy") {
        if (snapshot.text && snapshot.text.length > 0) {
          await Promise.resolve(handleSelected({ source, text: snapshot.text })).catch((err) => {
            logger.error({ err }, "selection: failed to copy console selection")
          })
        }
        return
      }
      if (!active) {
        return
      }

      active.callbacks.onSettle?.()
      const captured = active.callbacks.capture?.(snapshot)
      if (!captured || captured.text.length === 0) {
        active.callbacks.onCancel?.()
        return
      }

      selection.commit(active, captured)
    } finally {
      clearNativeSelection()
      selection.restore(active)
      active?.release()
      settling = false
    }
  }

  const handleMouseUp = () => {
    if (renderer.getSelection?.()?.isActive) {
      return
    }

    void settleSelection("root-mouse-up")
  }

  onMount(() => {
    const onSelection = () => {
      queueMicrotask(() => {
        void settleSelection("renderer-selection")
      })
    }
    renderer.on(CliRenderEvents.SELECTION, onSelection)

    const rendererConsole = (renderer as unknown as RendererWithConsoleSelection).console
    const previous = rendererConsole?.onCopySelection
    const onCopySelection = (text: string) => {
      void settleSelection("console-copy", text)
    }
    if (rendererConsole) {
      rendererConsole.onCopySelection = onCopySelection
    }

    onCleanup(() => {
      renderer.off(CliRenderEvents.SELECTION, onSelection)
      if (rendererConsole?.onCopySelection === onCopySelection) {
        rendererConsole.onCopySelection = previous
      }
    })
  })

  return {
    rootHandlers: {
      onMouseUp: handleMouseUp,
    },
  }
}
