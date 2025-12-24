import { useTheme } from "@app/providers/theme"

export type StatuslineProps = {
    title: string
}

export function Statusline({ title }: StatuslineProps) {
    const { theme } = useTheme()
    const palette = theme

    return (
        <box
            flexDirection="row"
            justifyContent="space-between"
            minHeight={1}
            maxHeight={1}
            marginTop={1}
            marginBottom={1}
            paddingLeft={3}
            paddingRight={1}
        >
            <text fg={palette().text}>{`[CONN] ${title}`}</text>
        </box>
    )
}
