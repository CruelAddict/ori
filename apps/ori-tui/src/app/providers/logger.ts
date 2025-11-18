import type { JSX } from "solid-js";
import { createComponent, createContext, useContext } from "solid-js";
import type { Logger } from "pino";

const LoggerContext = createContext<Logger>();

export interface LoggerProviderProps {
    logger: Logger;
    children: JSX.Element;
}

export function LoggerProvider(props: LoggerProviderProps) {
    return createComponent(LoggerContext.Provider, {
        value: props.logger,
        get children() {
            return props.children;
        },
    });
}

export function useLogger(): Logger {
    const logger = useContext(LoggerContext);
    if (!logger) {
        throw new Error("LoggerProvider is missing in component tree");
    }
    return logger;
}
