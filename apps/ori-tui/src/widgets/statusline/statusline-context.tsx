import { getAppDataDir } from "@shared/lib/data-storage";
import { useTheme } from "@app/providers/theme";
import { type Accessor, createContext, createSignal, type JSX, useContext } from "solid-js";

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
    const palette = theme();

    const [state, setState] = createSignal<StatuslineState>({
        left: [
            <text fg={palette.accent}>[CONN] {props.configurationName}</text>,
        ],
        right: [],
    });

    const fileOpenedInBuffer = (path: string | undefined) => {
        const left: JSX.Element[] = [
            <text fg={palette.accent}>[CONN] {props.configurationName}</text>,
        ];

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

        setState({ left, right: [] });
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
