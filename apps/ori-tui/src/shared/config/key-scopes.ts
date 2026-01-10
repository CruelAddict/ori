import type { KeyEvent } from "@opentui/core"
import { LEADER_KEY_PATTERN } from "@src/core/services/key-scopes"

export type CommandPaletteSection = "System" | "Navigation" | "Connection" | "Query"

export type KeyBinding = {
  pattern: string
  handler: (event: KeyEvent) => void
  description?: string
  enabled?: () => boolean
  preventDefault?: boolean
  priority?: number
  mode?: "normal" | "leader"
  commandPaletteSection?: CommandPaletteSection
}

export type Command = {
  id: string
  title: string
  section: CommandPaletteSection
  keyPattern: string
  handler: () => void
}

export const SYSTEM_LAYER = Number.POSITIVE_INFINITY

export type RegisterScopeOptions = {
  id: string
  parentId?: string | null
  priority?: number
  layer: number
  getBindings: () => KeyBinding[]
  isEnabled: () => boolean
}

interface ScopeEntry extends RegisterScopeOptions {
  depth: number
  order: number
}

export type DispatchPlan = {
  primary: ScopeEntry[]
  system: ScopeEntry[]
}

export type ScopeHandle = {
  id: string
  dispose(): void
}

export class KeyScopeStore {
  private scopes = new Map<string, ScopeEntry>()
  private orderCounter = 0

  registerScope(options: RegisterScopeOptions): ScopeHandle {
    const depth = this.resolveDepth(options.parentId) + 1
    const entry: ScopeEntry = {
      ...options,
      depth,
      order: ++this.orderCounter,
    }
    this.scopes.set(options.id, entry)
    return {
      id: options.id,
      dispose: () => {
        this.scopes.delete(options.id)
      },
    }
  }

  getDispatchPlan(): DispatchPlan {
    const enabled = Array.from(this.scopes.values()).filter((entry) => entry.isEnabled())
    const systemEntries = enabled.filter((entry) => !Number.isFinite(entry.layer))
    const normalEntries = enabled.filter((entry) => Number.isFinite(entry.layer))

    let primary: ScopeEntry[] = []
    if (normalEntries.length > 0) {
      const maxLayer = Math.max(...normalEntries.map((entry) => entry.layer))
      primary = normalEntries.filter((entry) => entry.layer === maxLayer)
    }

    return {
      primary: this.sortEntries(primary),
      system: this.sortEntries(systemEntries),
    }
  }

  private sortEntries(entries: ScopeEntry[]): ScopeEntry[] {
    return [...entries].sort((a, b) => {
      if (a.depth !== b.depth) {
        return b.depth - a.depth
      }
      const priorityA = a.priority ?? 0
      const priorityB = b.priority ?? 0
      if (priorityA !== priorityB) {
        return priorityB - priorityA
      }
      return b.order - a.order
    })
  }

  private resolveDepth(parentId?: string | null): number {
    if (!parentId) {
      return -1
    }
    const parent = this.scopes.get(parentId)
    if (!parent) {
      return -1
    }
    return parent.depth
  }

  getActiveCommands(): Command[] {
    return Array.from(this.scopes.values())
      .filter((scope) => scope.isEnabled())
      .flatMap((scope) =>
        scope
          .getBindings()
          .filter(
            (binding): binding is KeyBinding & { commandPaletteSection: CommandPaletteSection } =>
              Boolean(binding.commandPaletteSection) && (binding.enabled?.() ?? true),
          )
          .map((binding, i): Command => {
            return {
              id: `${scope.id}-${i}`,
              title: binding.description ?? "unnamed command",
              section: binding.commandPaletteSection,
              keyPattern: `${binding.mode === "leader" ? LEADER_KEY_PATTERN : ""} ${binding.pattern}`,
              handler: () => binding.handler({} as KeyEvent),
            }
          }),
      )
  }
}
