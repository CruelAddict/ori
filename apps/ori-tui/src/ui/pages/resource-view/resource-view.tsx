import { SplitScreen } from "@ui/components/split-screen"
import { createVM as createResourcePageVM } from "@ui/pages/resource-view/view-model/create-vm"
import { useAppContext } from "@ui/providers/app-context"
import { useOriClient } from "@ui/providers/client"
import { useEventStream } from "@ui/providers/events"
import { useLogger } from "@ui/providers/logger"
import { useResourceByName } from "@ui/providers/resource"
import { useTheme } from "@ui/providers/theme"
import { type KeyBinding, KeyScope } from "@ui/services/key-scopes"
import { EditorPanel } from "@ui/widgets/editor-panel/editor-panel"
import { Explorer } from "@ui/widgets/explorer/explorer"
import { ResultsPanel } from "@ui/widgets/results-panel/results-panel"
import { Statusline } from "@ui/widgets/statusline/statusline"
import { WelcomePane } from "@ui/widgets/welcome-pane/welcome-pane"
import { createResourceIntrospectionUC } from "@usecase/introspection/usecase"
import { createQueryUC } from "@usecase/query/usecase"
import { createResultSourceUC } from "@usecase/result-source/usecase"
import { createEffect, on, onCleanup, Show } from "solid-js"

export type ResourceViewPageProps = {
  resourceName: string
  isActive?: boolean
}

export function ResourceViewPage(props: ResourceViewPageProps) {
  const client = useOriClient()
  const logger = useLogger()
  const eventStream = useEventStream()
  const app = useAppContext()
  const resource = useResourceByName(() => props.resourceName)
  const scopeEnabled = () => props.isActive ?? true
  const query = createQueryUC({
    resourceName: props.resourceName,
    client,
    logger,
    subscribeEvents: eventStream.subscribe,
  })
  const resultSource = createResultSourceUC({
    resourceName: props.resourceName,
    logger,
    query,
    getAutoLimitRows: () => resource()?.autoLimitRows,
  })
  const introspection = createResourceIntrospectionUC({
    resourceName: props.resourceName,
    client,
    logger,
  })

  onCleanup(() => {
    resultSource.dispose()
    query.dispose()
    introspection.dispose()
  })

  const vm = createResourcePageVM({
    resourceName: () => props.resourceName,
    resource,
    resultSource,
    introspection,
  })
  const { theme } = useTheme()
  const palette = theme

  const unregisterResourceView = app.registerResourceView({
    resourceName: () => props.resourceName,
    title: vm.title,
    isActive: scopeEnabled,
    focusedPane: vm.focusedPane,
    visiblePanes: vm.visiblePanes,
    explorer: {
      isFocused: vm.explorer.isFocused,
      loading: vm.explorer.loading,
      error: vm.explorer.error,
      mode: vm.explorer.mode,
      filter: vm.explorer.filter,
      selectedId: vm.explorer.selectedId,
    },
    editor: {
      isFocused: vm.editorPane.isFocused,
      filePath: vm.editorPane.filePath,
      queryText: vm.editorPane.queryText,
    },
    results: {
      isFocused: vm.resultsPane.isFocused,
      job: vm.resultsPane.job,
      pagination: vm.resultsPane.pagination,
      isNavigating: vm.resultsPane.isNavigating,
    },
  })

  onCleanup(unregisterResourceView)

  createEffect(
    on(scopeEnabled, (active) => {
      vm.actions.setActive(active)
      if (!active) {
        return
      }
      if (!vm.editorPane.isFocused()) {
        return
      }
      const explorerWasOpen = vm.isPaneVisible("explorer")
      if (!explorerWasOpen) {
        vm.actions.toggleExplorerVisible()
      }
      vm.actions.focusPane("explorer")

      const timeoutId = setTimeout(() => {
        if (!scopeEnabled()) {
          return
        }
        if (!explorerWasOpen) {
          vm.actions.toggleExplorerVisible()
        }
        vm.actions.focusPane("editor")
      }, 10)

      onCleanup(() => clearTimeout(timeoutId))
    }),
  )

  const screenKeyBindings: KeyBinding[] = [
    {
      pattern: "ctrl+t",
      handler: vm.actions.toggleExplorerVisible,
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
      enabled: () => vm.resultsPane.job()?.status === "running" || vm.resultsPane.isNavigating(),
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
    <KeyScope
      bindings={screenKeyBindings}
      enabled={scopeEnabled}
    >
      <box
        flexDirection="column"
        justifyContent="flex-end"
        minHeight={"100%"}
      >
        <box
          flexDirection="row"
          backgroundColor={palette().get("panel_background")}
          marginTop={1}
          marginLeft={2}
          marginBottom={1}
          minHeight={0}
        >
          <SplitScreen
            orientation="vertical"
            firstVisible={vm.isPaneVisible("explorer")}
            initialPosition={{ mode: "ratio", ratio: 0.33 }}
            flexGrow={1}
            minHeight={"100%"}
            minSecondSize={38}
            first={<Explorer viewModel={vm.explorer} />}
            second={
              <SplitScreen
                orientation="horizontal"
                firstVisible={vm.isPaneVisible("editor") || !vm.isPaneVisible("results")}
                secondVisible={vm.isPaneVisible("results")}
                initialPosition={{ mode: "ratio", ratio: 0.5 }}
                flexGrow={1}
                justifyContent="space-between"
                showSeparator={false}
                minFirstSize={3}
                minSecondSize={3}
                first={
                  <Show
                    when={vm.isPaneVisible("editor")}
                    fallback={<WelcomePane />}
                  >
                    <EditorPanel viewModel={vm.editorPane} />
                  </Show>
                }
                second={<ResultsPanel viewModel={vm.resultsPane} />}
              />
            }
          />
        </box>
        <Statusline />
      </box>
    </KeyScope>
  )
}
