import { commandsHintPlugin } from "./plugins/commands-hint"
import { queryNoticePlugin } from "./plugins/query-notice"
import { resourceNamePlugin } from "./plugins/resource-name"
import { resultPaginationPlugin } from "./plugins/result-pagination"
import { selectionActionsPlugin } from "./plugins/selection-actions"
import type { StatuslineGroup } from "./statusline-types"

export const defaultStatuslineLayout = {
  justifyContent: "space-between",
  children: [
    resourceNamePlugin,
    {
      justifyContent: "flex-end",
      gap: 2,
      children: [queryNoticePlugin, resultPaginationPlugin, [selectionActionsPlugin, commandsHintPlugin]],
    },
  ],
} satisfies StatuslineGroup
