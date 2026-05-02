import type { SelectPopupItem } from "@ui/components/select-popup-model"

const COLUMN_GAP = 2
const LABEL_SHARE = 0.7
const ROW_PADDING = 2
const BORDER_WIDTH = 2
const POPUP_CHROME = ROW_PADDING + BORDER_WIDTH
const SECONDARY_SHARE = 1 - LABEL_SHARE

export type SelectPopupColumns = {
  labelWidth: number
  metaWidth: number
  descriptionWidth: number
}

export type SelectPopupItemLayout = {
  labelWidth: number
  metaWidth: number
  descriptionWidth: number
  metaCellWidth: number
  descriptionCellWidth: number
}

function getColumnWidths(items: readonly SelectPopupItem[]) {
  let maxLabelWidth = 0
  let maxMetaWidth = 0
  let maxDescriptionWidth = 0

  for (const item of items) {
    maxLabelWidth = Math.max(maxLabelWidth, Bun.stringWidth(item.label))
    maxMetaWidth = Math.max(maxMetaWidth, Bun.stringWidth(item.meta ?? ""))
    maxDescriptionWidth = Math.max(maxDescriptionWidth, Bun.stringWidth(item.description ?? ""))
  }

  return {
    maxLabelWidth,
    maxMetaWidth,
    maxDescriptionWidth,
  }
}

function getGap(width: number) {
  return width > 0 ? COLUMN_GAP : 0
}

function getCellWidth(width: number) {
  return width > 0 ? width + COLUMN_GAP : 0
}

export function getRequiredPopupWidth(items: readonly SelectPopupItem[]) {
  const widths = getColumnWidths(items)
  return (
    widths.maxLabelWidth +
    getGap(widths.maxMetaWidth) +
    widths.maxMetaWidth +
    getGap(widths.maxDescriptionWidth) +
    widths.maxDescriptionWidth +
    POPUP_CHROME
  )
}

export function getPopupColumns(items: readonly SelectPopupItem[], rowWidth: number): SelectPopupColumns | null {
  const widths = getColumnWidths(items)
  if (widths.maxMetaWidth <= 0 && widths.maxDescriptionWidth <= 0) {
    return null
  }

  const availableWidth = Math.max(1, rowWidth - ROW_PADDING)
  const metaGap = getGap(widths.maxMetaWidth)
  const descriptionGap = getGap(widths.maxDescriptionWidth)
  const gaps = metaGap + descriptionGap
  const naturalSecondaryWidth = gaps + widths.maxMetaWidth + widths.maxDescriptionWidth
  if (widths.maxLabelWidth + naturalSecondaryWidth <= availableWidth) {
    return {
      labelWidth: widths.maxLabelWidth,
      metaWidth: widths.maxMetaWidth,
      descriptionWidth: widths.maxDescriptionWidth,
    }
  }

  const secondaryBudget = Math.max(0, Math.floor(availableWidth * SECONDARY_SHARE) - gaps)
  const metaWidth = Math.min(widths.maxMetaWidth, secondaryBudget)
  const descriptionWidth = Math.min(widths.maxDescriptionWidth, Math.max(0, secondaryBudget - metaWidth))
  return {
    labelWidth: Math.max(1, availableWidth - gaps - metaWidth - descriptionWidth),
    metaWidth,
    descriptionWidth,
  }
}

export function getPopupItemLayout(
  item: SelectPopupItem,
  rowWidth: number,
  columns: SelectPopupColumns | null,
): SelectPopupItemLayout {
  const availableWidth = Math.max(1, rowWidth - ROW_PADDING)
  if (columns) {
    return {
      labelWidth: columns.labelWidth,
      metaWidth: columns.metaWidth,
      descriptionWidth: columns.descriptionWidth,
      metaCellWidth: getCellWidth(columns.metaWidth),
      descriptionCellWidth: getCellWidth(columns.descriptionWidth),
    }
  }

  const metaWidth = Bun.stringWidth(item.meta ?? "")
  const descriptionWidth = Bun.stringWidth(item.description ?? "")
  const metaCellWidth = getCellWidth(metaWidth)
  const descriptionCellWidth = getCellWidth(descriptionWidth)
  return {
    labelWidth: Math.max(1, availableWidth - metaCellWidth - descriptionCellWidth),
    metaWidth,
    descriptionWidth,
    metaCellWidth,
    descriptionCellWidth,
  }
}
