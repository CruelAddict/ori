import {
  ConnectionStateContext,
  createConnectionStateContextValue,
} from "@src/entities/connection/model/connection-state"
import type { JSX } from "solid-js"

export type ConnectionEntityProviderProps = {
  children: JSX.Element
}

export function ConnectionEntityProvider(props: ConnectionEntityProviderProps) {
  const value = createConnectionStateContextValue()

  return <ConnectionStateContext.Provider value={value}>{props.children}</ConnectionStateContext.Provider>
}
