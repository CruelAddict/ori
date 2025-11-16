import { TextAttributes } from "@opentui/core";
import { ConfigurationSelector } from "@src/widgets/configuration_selector/configuration_selector";
import { useConfigurationSelect } from "@src/features/configuration/select/use_configuration_select";

export function ConfigurationViewPage() {
    const vm = useConfigurationSelect();

    return (
        <box flexDirection="column" flexGrow={1} padding={1}>
            <text attributes={TextAttributes.BOLD}>Ori Database Explorer</text>
            <text attributes={TextAttributes.DIM}>{vm.serverLabel()}</text>
            <box height={1} />
            <ConfigurationSelector viewModel={vm} />
            <box height={1} />
            <text attributes={TextAttributes.DIM}>{vm.helpText}</text>
        </box>
    );
}
