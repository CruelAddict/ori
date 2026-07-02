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
  const activeSelection = useActiveSelectionOwner()
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

  const clearActiveSelection = () => {
    const active = activeSelection.active()
    active?.callbacks.onClear?.()
    active?.release()
  }

  const settleSelection = async (source: SelectionSource, text?: string) => {
    if (settling) {
      return
    }

    settling = true
    const active = activeSelection.active()
    try {
      active?.callbacks.onSettle?.()
      const snapshot = { source, text: readSelectedText(text) }
      const selectedText = active?.callbacks.readSelected?.(snapshot) ?? snapshot.text
      if (selectedText && selectedText.length > 0) {
        await Promise.resolve(handleSelected({ source, text: selectedText })).catch((err) => {
          logger.error({ err }, "selection: failed to handle selected text")
        })
      }
    } finally {
      clearNativeSelection()
      active?.callbacks.onClear?.()
      active?.release()
      settling = false
    }
  }

  const handleMouseMove = () => {
    if (!renderer.getSelection?.()?.isDragging) {
      return
    }

    void settleSelection("root-mouse-move")
  }

  const handleMouseUp = () => {
    if (renderer.getSelection?.()) {
      return
    }

    clearActiveSelection()
  }

  onMount(() => {
    const onSelection = () => {
      void settleSelection("renderer-selection")
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
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
    },
  }
}
