import type { ServerEvent } from "@shared/lib/events";
import type { JSX } from "solid-js";
import { createContext, createEffect, onCleanup, useContext } from "solid-js";
import { useOriClient } from "./client";
import { useLogger } from "./logger";

type EventListener = (event: ServerEvent) => void;

export type EventStreamContextValue = {
  subscribe(listener: EventListener): () => void;
};

const EventStreamContext = createContext<EventStreamContextValue>();

export type EventStreamProviderProps = {
  children: JSX.Element;
};

export function EventStreamProvider(props: EventStreamProviderProps) {
  const client = useOriClient();
  const logger = useLogger();
  const listeners = new Set<EventListener>();

  const subscribe = (listener: EventListener): (() => void) => {
    listeners.add(listener);
    logger.debug({ listenerCount: listeners.size }, "event stream: listener added");
    return () => {
      listeners.delete(listener);
      logger.debug({ listenerCount: listeners.size }, "event stream: listener removed");
    };
  };

  const dispatch = (event: ServerEvent) => {
    logger.debug({ eventType: event.type, listenerCount: listeners.size }, "event stream: dispatching event");
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err, eventType: event.type }, "event stream: listener threw error");
      }
    }
  };

  createEffect(() => {
    logger.debug("event stream: opening SSE connection");
    const dispose = client.openEventStream((event) => {
      logger.debug({ eventType: event.type }, "event stream: received event from SSE");
      dispatch(event);
    });
    onCleanup(() => {
      logger.debug("event stream: closing SSE connection");
      dispose();
    });
  });

  const value: EventStreamContextValue = { subscribe };

  return <EventStreamContext.Provider value={value}>{props.children}</EventStreamContext.Provider>;
}

export function useEventStream(): EventStreamContextValue {
  const ctx = useContext(EventStreamContext);
  if (!ctx) {
    throw new Error("EventStreamProvider is missing in component tree");
  }
  return ctx;
}
