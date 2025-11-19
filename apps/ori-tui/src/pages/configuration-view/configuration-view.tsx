import { TextAttributes } from "@opentui/core";
import { ConfigurationSelector } from "@src/widgets/configuration-selector/configuration-selector";
import { useConfigurationSelect } from "@src/features/configuration/select/use-configuration-select";
import { useTheme } from "@app/providers/theme";

export function ConfigurationViewPage() {
    const vm = useConfigurationSelect();
    const { theme } = useTheme();
    const palette = theme;

    return (
        <box flexDirection="column" flexGrow={1} padding={1} backgroundColor={palette().background}>
            <text attributes={TextAttributes.BOLD} fg={palette().text}>
                Ori Database Explorer
            </text>
            <text attributes={TextAttributes.DIM} fg={palette().textMuted}>
                {vm.serverLabel()}
            </text>
            <box height={1} />
            <ConfigurationSelector viewModel={vm} />
            <box height={1} />
            <text attributes={TextAttributes.DIM} fg={palette().textMuted}>
                {vm.helpText}
            </text>
        </box>
    );
}
