import { type Command, useActiveCommands } from "@src/core/services/key-scopes"
import { DialogSelect, type DialogSelectOption } from "@widgets/dialog-select"
import { createMemo } from "solid-js"
import type { OverlayComponentProps } from "./overlay-store"

export function CommandPaletteOverlay(props: OverlayComponentProps) {
  const getCommands = useActiveCommands()

  const options = createMemo<DialogSelectOption<Command>[]>(() =>
    getCommands()
      .reverse()
      .map((cmd) => ({
        id: cmd.id,
        title: cmd.title,
        value: cmd,
        category: cmd.section,
        badge: cmd.keyPattern,
      })),
  )

  const handleSelect = (option: DialogSelectOption<Command>) => {
    option.value.handler()
    props.close()
  }

  return (
    <DialogSelect
      title="Commands"
      placeholder="Type to search"
      emptyMessage="No commands available"
      width={80}
      maxHeight={16}
      options={options}
      onSelect={handleSelect}
      onCancel={props.close}
    />
  )
}
