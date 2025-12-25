import { useTheme } from "@app/providers/theme";
import { getAppDataDir } from "@shared/lib/data-storage";
import path from "node:path";
import { type Accessor, createContext, createMemo, createSignal, type JSX, useContext } from "solid-js";

type StatuslineState = {
  left: JSX.Element[];
  right: JSX.Element[];
};

type StatuslineMethods = {
  fileOpenedInBuffer: (path: string | undefined) => void;
};

interface StatuslineContextValue extends StatuslineMethods {
  state: Accessor<StatuslineState>;
}

const StatuslineContext = createContext<StatuslineContextValue>();

export type StatuslineProviderProps = {
  configurationName: string;
  children: JSX.Element;
};

export function StatuslineProvider(props: StatuslineProviderProps) {
  const { theme } = useTheme();
  const [filePath, setFilePath] = createSignal<string | undefined>(undefined);

  const state = createMemo<StatuslineState>(() => {
    const palette = theme();
    const left: JSX.Element[] = [
      <box
        flexDirection="row"
        maxHeight={1}
      >
        <text fg={palette.success}>• </text>
        <text fg={palette.text}>{props.configurationName}</text>
      </box>
    ]

    const pathValue = filePath();
    if (pathValue) {
      const appDataDir = getAppDataDir();
      let displayPath = pathValue;
      if (pathValue.startsWith(appDataDir)) {
        const relativePath = pathValue.slice(appDataDir.length);
        const homeDir = process.env.HOME ?? "";
        if (appDataDir.startsWith(homeDir)) {
          displayPath = `~${relativePath}`;
        } else {
          displayPath = relativePath;
        }
      }
      left[1] = (
        <box flexDirection="row">
          <text fg={palette.textMuted}>{path.dirname(displayPath)}/</text>
          <text fg={palette.text}>{path.basename(displayPath)}</text>
        </box>
      );
    }

    return {
      left,
      right: [
        <box
          flexDirection="row"
          maxHeight={1}
        >
          <text fg={palette.text}>ctr+p </text>
          <text fg={palette.textMuted}>commands</text>
        </box>,
      ],
    };
  });

  const fileOpenedInBuffer = (path: string | undefined) => {
    setFilePath(path);
  };

  const value: StatuslineContextValue = {
    state,
    fileOpenedInBuffer,
  };

  return <StatuslineContext.Provider value={value}>{props.children}</StatuslineContext.Provider>;
}

export function useStatusline(): StatuslineContextValue {
  const ctx = useContext(StatuslineContext);
  if (!ctx) {
    throw new Error("StatuslineProvider is missing in component tree");
  }
  return ctx;
}
