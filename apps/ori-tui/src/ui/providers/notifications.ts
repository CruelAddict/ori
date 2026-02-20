import type { JSX } from "solid-js"
import { createComponent, createContext, onCleanup, useContext } from "solid-js"

import { useLogger } from "./logger"

export type NotificationLevel = "info" | "warn" | "success" | "error"
export type NotificationChannel = "statusline"

export type NotificationStyle = {
  level: NotificationLevel
  channel: NotificationChannel
}

export type Notification = {
  id: string
  message: string
  style: NotificationStyle
  createdAt: number
}

export type NotificationsContextValue = {
  notify(message: string, style: NotificationStyle): void
  notifications(channel: NotificationChannel, options?: { signal?: AbortSignal }): AsyncGenerator<Notification>
}

const MAX_QUEUE_SIZE = 20

function createNotificationsState() {
  const queues = new Map<NotificationChannel, Notification[]>()
  const waiters = new Map<NotificationChannel, Array<(notification: Notification | null) => void>>()
  let disposed = false

  const ensureQueue = (channel: NotificationChannel) => {
    const existing = queues.get(channel)
    if (existing) {
      return existing
    }
    const next: Notification[] = []
    queues.set(channel, next)
    return next
  }

  const ensureWaiters = (channel: NotificationChannel) => {
    const existing = waiters.get(channel)
    if (existing) {
      return existing
    }
    const next: Array<(notification: Notification | null) => void> = []
    waiters.set(channel, next)
    return next
  }

  const settleAllWaiters = () => {
    for (const list of waiters.values()) {
      while (list.length > 0) {
        const resolve = list.shift()
        resolve?.(null)
      }
    }
  }

  const notify = (notification: Notification) => {
    if (disposed) return
    const channelWaiters = ensureWaiters(notification.style.channel)
    if (channelWaiters.length > 0) {
      const resolve = channelWaiters.shift()
      resolve?.(notification)
      return
    }
    const queue = ensureQueue(notification.style.channel)
    queue.push(notification)
    if (queue.length > MAX_QUEUE_SIZE) {
      queue.shift()
    }
  }

  const notifications = async function* (channel: NotificationChannel, options?: { signal?: AbortSignal }) {
    const queue = ensureQueue(channel)
    const channelWaiters = ensureWaiters(channel)
    const signal = options?.signal

    while (!disposed) {
      if (signal?.aborted) {
        break
      }

      if (queue.length > 0) {
        const next = queue.shift()
        if (next) {
          yield next
          continue
        }
      }

      const next = await new Promise<Notification | null>((resolve) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort)
          resolve(null)
        }

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true })
        }

        channelWaiters.push((notification) => {
          signal?.removeEventListener("abort", onAbort)
          resolve(notification)
        })
      })

      if (!next) {
        break
      }

      yield next
    }
  }

  const dispose = () => {
    disposed = true
    settleAllWaiters()
    queues.clear()
    waiters.clear()
  }

  return { notify, notifications, dispose }
}

const NotificationsContext = createContext<NotificationsContextValue>()

export type NotificationsProviderProps = {
  children: JSX.Element
}

export function NotificationsProvider(props: NotificationsProviderProps) {
  const logger = useLogger()
  const state = createNotificationsState()

  const notify = (message: string, style: NotificationStyle) => {
    const notification: Notification = {
      id: crypto.randomUUID(),
      message,
      style,
      createdAt: Date.now(),
    }
    logger.debug({ channel: style.channel, level: style.level }, "notifications: enqueue")
    state.notify(notification)
  }

  onCleanup(() => state.dispose())

  const value: NotificationsContextValue = {
    notify,
    notifications: state.notifications,
  }

  return createComponent(NotificationsContext.Provider, {
    value,
    get children() {
      return props.children
    },
  })
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error("NotificationsProvider is missing in component tree")
  }
  return ctx
}
