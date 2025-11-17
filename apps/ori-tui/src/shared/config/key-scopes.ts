import type { KeyEvent } from "@opentui/core";

export interface KeyBinding {
    pattern: string;
    handler: (event: KeyEvent) => void;
    description?: string;
    when?: () => boolean;
    preventDefault?: boolean;
    priority?: number;
    mode?: "normal" | "leader";
}

export interface RegisterScopeOptions {
    id: string;
    parentId?: string | null;
    priority?: number;
    getBindings: () => KeyBinding[];
    isEnabled: () => boolean;
}

interface ScopeEntry extends RegisterScopeOptions {
    depth: number;
    order: number;
}

export interface ScopeHandle {
    id: string;
    dispose(): void;
}

export class KeyScopeStore {
    private scopes = new Map<string, ScopeEntry>();
    private orderCounter = 0;

    registerScope(options: RegisterScopeOptions): ScopeHandle {
        const depth = this.resolveDepth(options.parentId) + 1;
        const entry: ScopeEntry = {
            ...options,
            depth,
            order: ++this.orderCounter,
        };
        this.scopes.set(options.id, entry);
        return {
            id: options.id,
            dispose: () => {
                this.scopes.delete(options.id);
            },
        };
    }

    getDispatchList(): ScopeEntry[] {
        return Array.from(this.scopes.values())
            .filter((entry) => entry.isEnabled())
            .sort((a, b) => {
                if (a.depth !== b.depth) {
                    return b.depth - a.depth;
                }
                const priorityA = a.priority ?? 0;
                const priorityB = b.priority ?? 0;
                if (priorityA !== priorityB) {
                    return priorityB - priorityA;
                }
                return b.order - a.order;
            });
    }

    private resolveDepth(parentId?: string | null): number {
        if (!parentId) {
            return -1;
        }
        const parent = this.scopes.get(parentId);
        if (!parent) {
            return -1;
        }
        return parent.depth;
    }
}
