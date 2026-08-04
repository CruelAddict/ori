import { useSelection } from "@ui/providers/selection"
import { KeyScope, SELECTION_LAYER } from "@ui/services/key-scopes"

export function SelectionHotkeys() {
  const selection = useSelection()

  return (
    <KeyScope
      layer={SELECTION_LAYER}
      enabled={selection.isActive}
      bindings={() => {
        const actions = selection.actions()

        return [
          ...actions.map((action) => ({
            pattern: action.key,
            handler: () => action.run({ clearSelection: false }),
            preventDefault: true,
          })),
          {
            pattern: "escape",
            handler: selection.clear,
            preventDefault: true,
          },
        ]
      }}
    />
  )
}
