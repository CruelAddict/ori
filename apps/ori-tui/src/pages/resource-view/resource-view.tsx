import { useTheme } from "@app/providers/theme"
import { type KeyBinding, KeyScope } from "@src/core/services/key-scopes"
import { createResourcePageModel } from "@src/pages/resource-view/model/create-resource-page-model"
import { EditorPanel } from "@src/widgets/editor-panel/editor-panel"
import { ResultsPanel } from "@src/widgets/results-panel/results-panel"
import { Statusline, StatuslineProvider } from "@src/widgets/statusline/statusline"
import { TreePanel } from "@src/widgets/tree-panel/tree-panel"
import { WelcomePane } from "@src/widgets/welcome-pane/welcome-pane"
import { createEffect, on, onCleanup, Show } from "solid-js"

export type ResourceViewPageProps = {
  resourceName: string
  isActive?: boolean
}

export function ResourceViewPage(props: ResourceViewPageProps) {
  const vm = createResourcePageModel({
    resourceName: () => props.resourceName,
  })
  const { theme } = useTheme()
  const palette = theme
  const scopeEnabled = () => props.isActive ?? true

  createEffect(
    on(scopeEnabled, (active) => {
      // a hack to make textarea in the editor receive focus
      vm.actions.setActive(active)
      if (!active) {
        return
      }
      if (!vm.editorPane.isFocused()) {
        return
      }
      const treeWasOpen = vm.isPaneVisible("tree")
      if (!treeWasOpen) {
        vm.actions.toggleTreeVisible()
      }
      vm.actions.focusPane("tree")

      const timeoutId = setTimeout(() => {
        if (!scopeEnabled()) {
          return
        }
        if (!treeWasOpen) {
          vm.actions.toggleTreeVisible()
        }
        vm.actions.focusPane("editor")
      }, 10)

      onCleanup(() => clearTimeout(timeoutId))
    }),
  )

  const screenKeyBindings: KeyBinding[] = [
    {
      pattern: "ctrl+t",
      handler: vm.actions.toggleTreeVisible,
      preventDefault: true,
    },
    {
      pattern: "ctrl+r",
      handler: vm.actions.toggleResultsVisible,
      preventDefault: true,
    },
    {
      pattern: "ctrl+shift+r",
      handler: () => {
        void vm.actions.refreshGraph()
      },
      preventDefault: true,
    },
    {
      pattern: "ctrl+g",
      description: "Cancel running query",
      handler: () => {
        void vm.actions.cancelQuery()
      },
      enabled: () => vm.editorPane.isExecuting(),
      preventDefault: true,
      commandPaletteSection: "Query",
    },
    {
      pattern: "h",
      mode: "leader",
      handler: vm.actions.moveFocusLeft,
      preventDefault: true,
    },
    {
      pattern: "l",
      mode: "leader",
      handler: vm.actions.moveFocusRight,
      preventDefault: true,
    },
    {
      pattern: "j",
      mode: "leader",
      handler: vm.actions.moveFocusDown,
      preventDefault: true,
    },
    {
      pattern: "k",
      mode: "leader",
      handler: vm.actions.moveFocusUp,
      preventDefault: true,
    },
    {
      pattern: "ctrl+s",
      handler: () => {
        vm.editorPane.saveQuery()
      },
      preventDefault: true,
    },
    {
      pattern: "q",
      handler: () => {
        if (!vm.isPaneVisible("editor")) {
          vm.actions.openEditor()
          return
        }
        vm.actions.focusPane("editor")
      },
      enabled: () => !vm.editorPane.isFocused(),
      preventDefault: true,
    },
  ]

  return (
    <StatuslineProvider resourceName={props.resourceName}>
      <KeyScope
        bindings={screenKeyBindings}
        enabled={scopeEnabled}
      >
        <box
          flexDirection="row"
          backgroundColor={palette().get("panel_background")}
          marginTop={1}
          marginLeft={2}
          marginBottom={1}
        >
          <Show when={vm.isPaneVisible("tree")}>
            <TreePanel viewModel={vm.treePane} />
          </Show>

          <box
            flexDirection="column"
            flexGrow={1}
            marginLeft={vm.isPaneVisible("tree") ? 1 : 0}
            justifyContent="space-between"
          >
            <Show
              when={vm.isPaneVisible("editor")}
              fallback={<WelcomePane />}
            >
              <EditorPanel viewModel={vm.editorPane} />
            </Show>
            <Show when={vm.isPaneVisible("results")}>
              <ResultsPanel viewModel={vm.resultsPane} />
            </Show>
          </box>
        </box>
        <Statusline />
      </KeyScope>
    </StatuslineProvider>
  )
}
