import { useTheme } from "@app/providers/theme";
import { getAppDataDir } from "@shared/lib/data-storage";
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
        const left: JSX.Element[] = [<text fg={palette.accent}>[CONN] {props.configurationName}</text>];

        const path = filePath();
        if (path) {
            const appDataDir = getAppDataDir();
            let displayPath = path;
            if (path.startsWith(appDataDir)) {
                const relativePath = path.slice(appDataDir.length);
                const homeDir = process.env.HOME ?? "";
                if (appDataDir.startsWith(homeDir)) {
                    displayPath = `~${relativePath}`;
                } else {
                    displayPath = relativePath;
                }
            }
            left[1] = <text fg={palette.textMuted}>{displayPath}</text>;
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
