import { type Notification, type NotificationLevel, useNotifications } from "@app/providers/notifications"
import { useTheme } from "@app/providers/theme"
import { debounce } from "@shared/lib/debounce"
import { formatFilePath } from "@shared/lib/path-format"
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  useContext,
} from "solid-js"

type StatuslineState = {
  left: JSX.Element[]
  right: JSX.Element[]
}

type StatuslineMethods = {
  fileOpenedInBuffer: (path: string | undefined) => void
}

interface StatuslineContextValue extends StatuslineMethods {
  state: Accessor<StatuslineState>
}

const StatuslineContext = createContext<StatuslineContextValue>()

export type StatuslineProviderProps = {
  configurationName: string
  children: JSX.Element
}

export function StatuslineProvider(props: StatuslineProviderProps) {
  const { theme } = useTheme()
  const notifications = useNotifications()
  const [filePath, setFilePath] = createSignal<string | undefined>(undefined)
  const [currentNotification, setCurrentNotification] = createSignal<Notification | undefined>(undefined)

  createEffect(() => {
    const abortController = new AbortController()
    const clearNotification = debounce(() => setCurrentNotification(undefined), 3000)

    const run = async () => {
      for await (const notification of notifications.notifications("statusline", { signal: abortController.signal })) {
        setCurrentNotification(notification)
        clearNotification()
      }
    }

    void run()

    onCleanup(() => {
      abortController.abort()
      clearNotification.clear()
      setCurrentNotification(undefined)
    })
  })

  const state = createMemo<StatuslineState>(() => {
    const palette = theme()
    const left: JSX.Element[] = [
      <box
        flexDirection="row"
        maxHeight={1}
      >
        <text fg={palette.get("success")}>• </text>
        <text fg={palette.get("text")}>{props.configurationName}</text>
      </box>,
    ]

    const pathValue = filePath()
    if (pathValue) {
      const { dirPath, fileName } = formatFilePath(pathValue)
      left[1] = (
        <box flexDirection="row">
          <text fg={palette.get("text_muted")}>{dirPath}</text>
          <text fg={palette.get("text")}>{fileName}</text>
        </box>
      )
    }

    const right: JSX.Element[] = [
      <box
        flexDirection="row"
        maxHeight={1}
      >
        <text fg={palette.get("text")}>ctr+x + h/j/k/l </text>
        <text
          fg={palette.get("text_muted")}
          marginRight={2}
        >
          navigate panes
        </text>
        <text fg={palette.get("text")}>ctr+p </text>
        <text fg={palette.get("text_muted")}>commands</text>
      </box>,
    ]

    const colorByLevel = (level: NotificationLevel): string => {
      switch (level) {
        case "error":
          return palette.get("error")
        case "success":
          return palette.get("success")
        default:
          return palette.get("text_muted")
      }
    }

    const notification = currentNotification()
    if (notification) {
      right.push(
        <>
          <text fg={colorByLevel(notification.style.level)}>• </text>
          <text fg={palette.get("text_muted")}>{notification.message}</text>
        </>,
      )
    }

    return {
      left,
      right,
    }
  })

  const fileOpenedInBuffer = (path: string | undefined) => {
    setFilePath(path)
  }

  const value: StatuslineContextValue = {
    state,
    fileOpenedInBuffer,
  }

  return <StatuslineContext.Provider value={value}>{props.children}</StatuslineContext.Provider>
}

export function useStatusline(): StatuslineContextValue {
  const ctx = useContext(StatuslineContext)
  if (!ctx) {
    throw new Error("StatuslineProvider is missing in component tree")
  }
  return ctx
}
