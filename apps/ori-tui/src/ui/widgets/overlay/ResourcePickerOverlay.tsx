import type { Resource } from "@model/resource"
import { type ResourceConnectionState, useResourceEntity } from "@ui/providers/resource"
import { useRouteNavigation } from "@ui/routes/router"
import { resourceRoute } from "@ui/routes/types"
import { DialogSelect, type DialogSelectOption } from "@ui/widgets/dialog-select"
import { createEffect, createMemo, createSignal } from "solid-js"
import type { OverlayComponentProps } from "./overlay-store"

const getResourcePrefix = (record?: ResourceConnectionState) => {
  if (!record || record.status === "idle") return "–"
  if (record.status === "connected") return "∿"
  if (record.status === "failed") return "×"
  if (record.status === "requesting" || record.status === "waiting") return "⋯"
  return "–"
}

export function ResourcePickerOverlay(props: OverlayComponentProps) {
  const resourceEntity = useResourceEntity()
  const navigation = useRouteNavigation()
  const [pendingName, setPendingName] = createSignal<string | null>(null)

  const options = createMemo<DialogSelectOption<Resource>[]>(() => {
    const list = resourceEntity.resources()
    const connections = resourceEntity.connections()
    return list.map((resource) => {
      const record = connections[resource.name]
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
    const connections = resourceEntity.connections()
    const record = connections[intent]
    if (!record) return
    if (record.status === "connected") {
      navigateToResource(intent)
    }
  })

  createEffect(() => {
    const intent = pendingName()
    if (!intent) return
    const record = resourceEntity.connections()[intent]
    if (record?.status === "failed") {
      setPendingName(null)
    }
  })

  const handleSelect = (option: DialogSelectOption<Resource>) => {
    const name = option.value.name
    setPendingName(name)
    const connections = resourceEntity.connections()
    const record = connections[name]

    if (record?.status === "connected") {
      navigateToResource(name)
      return
    }

    if (!record || record.status === "idle" || record.status === "failed") {
      void resourceEntity.connect(name)
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
