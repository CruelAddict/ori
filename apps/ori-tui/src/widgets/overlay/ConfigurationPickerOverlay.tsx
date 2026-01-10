import { useRouteNavigation } from "@app/routes/router"
import { connectionRoute } from "@app/routes/types"
import type { Configuration } from "@src/entities/configuration/model/configuration"
import { useConfigurationListStore } from "@src/entities/configuration/model/configuration-list-store"
import { type ConnectionRecord, useConnectionState } from "@src/entities/connection/model/connection-state"
import { DialogSelect, type DialogSelectOption } from "@widgets/dialog-select"
import { createEffect, createMemo, createSignal } from "solid-js"
import type { OverlayComponentProps } from "./overlay-store"

const getConnectionPrefix = (record?: ConnectionRecord) => {
  if (!record || record.status === "idle") return "–"
  if (record.status === "connected") return "∿"
  if (record.status === "failed") return "×"
  if (record.status === "requesting" || record.status === "waiting") return "⋯"
  return "–"
}

export function ConfigurationPickerOverlay(props: OverlayComponentProps) {
  const store = useConfigurationListStore()
  const connectionState = useConnectionState()
  const navigation = useRouteNavigation()
  const [pendingName, setPendingName] = createSignal<string | null>(null)

  const options = createMemo<DialogSelectOption<Configuration>[]>(() => {
    const list = store.configurations()
    const records = connectionState.records()
    return list.map((configuration) => {
      const record = records[configuration.name]
      const prefix = getConnectionPrefix(record)
      return {
        id: configuration.name,
        title: `${prefix} ${configuration.name}`,
        badge: `${configuration.type}`,
        value: configuration,
      } satisfies DialogSelectOption<Configuration>
    })
  })

  const navigateToConfiguration = (configurationName: string) => {
    navigation.push(connectionRoute(configurationName))
    setPendingName(null)
    props.close()
  }

  createEffect(() => {
    const intent = pendingName()
    if (!intent) return
    const records = connectionState.records()
    const record = records[intent]
    if (!record) return
    if (record.status === "connected") {
      navigateToConfiguration(intent)
    }
  })

  createEffect(() => {
    const intent = pendingName()
    if (!intent) return
    const record = connectionState.records()[intent]
    if (record?.status === "failed") {
      setPendingName(null)
    }
  })

  const handleSelect = (option: DialogSelectOption<Configuration>) => {
    const name = option.value.name
    setPendingName(name)
    const records = connectionState.records()
    const record = records[name]

    if (record?.status === "connected") {
      navigateToConfiguration(name)
      return
    }

    if (!record || record.status === "idle" || record.status === "failed") {
      void connectionState.connect(option.value)
    }
  }

  const handleCancel = () => {
    setPendingName(null)
    props.close()
  }

  return (
    <DialogSelect
      title="Select database"
      placeholder="Type to search"
      emptyMessage="No configurations available"
      width={80}
      maxHeight={16}
      options={options}
      selectedId={pendingName}
      onSelect={handleSelect}
      onCancel={handleCancel}
    />
  )
}
