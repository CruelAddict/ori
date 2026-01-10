import type { ClientMode, CreateClientOptions, OriClient } from "@shared/lib/configurations-client"
import { createOriClient } from "@shared/lib/configurations-client"
import type { JSX } from "solid-js"
import { createComponent, createContext, useContext } from "solid-js"
import { useLogger } from "./logger"

type ClientContextValue = {
  client: OriClient
  mode: ClientMode
  host?: string
  port?: number
  socketPath?: string
}

const ClientContext = createContext<ClientContextValue>()

export type ClientProviderProps = {
  options: Omit<CreateClientOptions, "logger">
  children: JSX.Element
}

export function ClientProvider(props: ClientProviderProps) {
  const logger = useLogger()
  const client = createOriClient({ ...props.options, logger })
  const value: ClientContextValue = {
    client,
    mode: props.options.mode,
    host: props.options.host,
    port: props.options.port,
    socketPath: props.options.socketPath,
  }

  return createComponent(ClientContext.Provider, {
    value,
    get children() {
      return props.children
    },
  })
}

export function useOriClient(): OriClient {
  const ctx = useContext(ClientContext)
  if (!ctx) {
    throw new Error("ClientProvider is missing in component tree")
  }
  return ctx.client
}

export function useClientInfo() {
  const ctx = useContext(ClientContext)
  if (!ctx) {
    throw new Error("ClientProvider is missing in component tree")
  }
  return ctx
}
