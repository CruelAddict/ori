import { createSignal, type Accessor, type Component } from "solid-js";

export interface OverlayComponentProps {
    close: () => void;
}

export interface OverlayEntry {
    id: string;
    render: Component<OverlayComponentProps>;
    zIndex: number;
}

export interface OverlayOptions {
    id?: string;
    render: Component<OverlayComponentProps>;
    zIndex?: number;
}

export interface OverlayManager {
    overlays: Accessor<OverlayEntry[]>;
    show(options: OverlayOptions): string;
    dismiss(id: string): void;
    dismissAll(): void;
}

export function createOverlayManager(): OverlayManager {
    const [overlays, setOverlays] = createSignal<OverlayEntry[]>([]);
    let overlayIdCounter = 0;
    let nextLayer = 1;

    const show = (options: OverlayOptions) => {
        const id = options.id ?? `overlay-${++overlayIdCounter}`;
        const zIndex = options.zIndex ?? nextLayer++;
        setOverlays((prev) => [...prev, { id, render: options.render, zIndex }]);
        return id;
    };

    const dismiss = (id: string) => {
        setOverlays((prev) => prev.filter((entry) => entry.id !== id));
    };

    const dismissAll = () => {
        setOverlays([]);
        nextLayer = 1;
    };

    return {
        overlays,
        show,
        dismiss,
        dismissAll,
    };
}
