import type { BufferExtension } from "../../extension"
import type { StatementSource } from "../statements"

const DEFAULT_MARKER = " •"
const DEFAULT_ACTIVE_MARKER = " 󰻃"
const DEFAULT_AMBIGUOUS_MARKER = " ?"

export type StatementGutterMarkersOptions = {
  id: string
  statements: StatementSource
  marker?: string
  activeMarker?: string
}

export function createStatementGutterMarkersExtension(options: StatementGutterMarkersOptions): BufferExtension {
  return {
    id: options.id,
    setup: (host) => {
      const render = () => {
        const statements = options.statements.read()
        if (!statements || statements.entries.length < 2) {
          host.setGutterMarkers(new Map())
          return
        }

        const marker = options.marker ?? DEFAULT_MARKER
        const activeMarker = options.activeMarker ?? DEFAULT_ACTIVE_MARKER
        const markers = new Map<number, string>()
        const line = host.getCursor()?.line
        for (const statement of statements.entries) {
          markers.set(statement.startLine, marker)
        }

        const activeIndices = line === undefined ? undefined : statements.lineToStatements[line]
        if (line !== undefined && (activeIndices?.length ?? 0) > 1) {
          markers.set(line, DEFAULT_AMBIGUOUS_MARKER)
          host.setGutterMarkers(markers)
          return
        }

        const activeStatement =
          activeIndices && activeIndices.length > 0 ? statements.entries[activeIndices[0] ?? -1] : undefined
        if (activeStatement) {
          markers.set(activeStatement.startLine, activeMarker)
        }

        host.setGutterMarkers(markers)
      }

      const unsubscribeDocument = host.onDocumentChange(() => {
        host.requestDecorationsRender()
      })
      const unsubscribeRender = host.onDecorationsRender(render)

      return () => {
        unsubscribeDocument()
        unsubscribeRender()
        host.setGutterMarkers(new Map())
      }
    },
  }
}
