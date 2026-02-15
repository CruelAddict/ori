import { useRouteNavigation } from "@app/routes/router"
import { resourceRoute } from "@app/routes/types"
import { type ConnectionRecord, useConnectionState } from "@src/entities/connection/model/connection-state"
import type { Resource } from "@src/entities/resource/model/resource"
import { useResourceListStore } from "@src/entities/resource/model/resource-list-store"
import { DialogSelect, type DialogSelectOption } from "@widgets/dialog-select"
import { createEffect, createMemo, createSignal } from "solid-js"
import type { OverlayComponentProps } from "./overlay-store"

const getResourcePrefix = (record?: ConnectionRecord) => {
  if (!record || record.status === "idle") return "–"
  if (record.status === "connected") return "∿"
  if (record.status === "failed") return "×"
  if (record.status === "requesting" || record.status === "waiting") return "⋯"
  return "–"
}

export function ResourcePickerOverlay(props: OverlayComponentProps) {
  const store = useResourceListStore()
  const connectionState = useConnectionState()
  const navigation = useRouteNavigation()
  const [pendingName, setPendingName] = createSignal<string | null>(null)

  const options = createMemo<DialogSelectOption<Resource>[]>(() => {
    const list = store.resources()
    const records = connectionState.records()
    return list.map((resource) => {
      const record = records[resource.name]
      const prefix = getResourcePrefix(record)
      return {
        id: resource.name,
        title: `${prefix} ${resource.name}`,
        badge: `${resource.type}`,
        value: resource,
      } satisfies DialogSelectOption<Resource>
    })
  })

  const navigateToResource = (resourceName: string) => {
    navigation.push(resourceRoute(resourceName))
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
      navigateToResource(intent)
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

  const handleSelect = (option: DialogSelectOption<Resource>) => {
    const name = option.value.name
    setPendingName(name)
    const records = connectionState.records()
    const record = records[name]

    if (record?.status === "connected") {
      navigateToResource(name)
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
      title="Select resource"
      placeholder="Type to search"
      emptyMessage="No resources available"
      width={80}
      maxHeight={16}
      options={options}
      selectedId={pendingName}
      onSelect={handleSelect}
      onCancel={handleCancel}
    />
  )
}
