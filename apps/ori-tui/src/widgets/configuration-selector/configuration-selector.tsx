import { For, Show, type Accessor } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { ConfigurationSelectViewModel } from "@src/features/configuration/select/use-configuration-select";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { KeyScope } from "@src/core/services/key-scopes";
import type { KeyBinding } from "@src/core/stores/key-scopes";
import { useTheme } from "@app/providers/theme";
import type { Theme } from "@app/theme";

export interface ConfigurationSelectorProps {
    viewModel: ConfigurationSelectViewModel;
}

export function ConfigurationSelector(props: ConfigurationSelectorProps) {
    const vm = props.viewModel;
    const { theme } = useTheme();
    const palette = theme;

    const bindings: KeyBinding[] = [
        { pattern: "up", handler: vm.actions.moveUp, preventDefault: true },
        { pattern: "k", handler: vm.actions.moveUp, preventDefault: true },
        { pattern: "ctrl+p", handler: vm.actions.moveUp, preventDefault: true },
        { pattern: "down", handler: vm.actions.moveDown, preventDefault: true },
        { pattern: "j", handler: vm.actions.moveDown, preventDefault: true },
        { pattern: "ctrl+n", handler: vm.actions.moveDown, preventDefault: true },
        { pattern: "pageup", handler: vm.actions.pageUp, preventDefault: true },
        { pattern: "pagedown", handler: vm.actions.pageDown, preventDefault: true },
        { pattern: "return", handler: vm.actions.select, preventDefault: true },
        { pattern: "ctrl+r", handler: () => void vm.actions.refresh(), preventDefault: true },
    ];

    return (
        <KeyScope id="configuration-list" bindings={bindings}>
            <Show when={!vm.loading()} fallback={<text fg={palette().text}>Loading configurations...</text>}>
                <Show
                    when={!vm.error()}
                    fallback={
                        <text fg={palette().error}>Failed to load configurations: {vm.error()}</text>
                    }
                >
                    <ConfigurationList
                        theme={palette}
                        configurations={vm.configurations()}
                        isSelected={vm.isSelected}
                        rowStatus={vm.rowStatus}
                    />
                    <Show when={vm.connectBanner()}>
                        {(message: Accessor<string>) => (
                            <>
                                <box height={1} />
                                <text fg={palette().warning}>{message()}</text>
                            </>
                        )}
                    </Show>
                </Show>
            </Show>
        </KeyScope>
    );
}

interface ConfigurationListProps {
    theme: Accessor<Theme>;
    configurations: Configuration[];
    isSelected: (index: number) => boolean;
    rowStatus: (configuration: Configuration) => string;
}

function ConfigurationList(props: ConfigurationListProps) {
    return (
        <box flexDirection="column">
            <text attributes={TextAttributes.BOLD} fg={props.theme().text}>
                Configurations:
            </text>
            <box height={1} />
            <For each={props.configurations}>
                {(configuration, index) => (
                    <ConfigurationRow
                        theme={props.theme}
                        configuration={configuration}
                        index={index()}
                        isSelected={props.isSelected(index())}
                        status={props.rowStatus(configuration)}
                    />
                )}
            </For>
            <Show when={props.configurations.length === 0}>
                <text attributes={TextAttributes.DIM} fg={props.theme().textMuted}>
                    No configurations found.
                </text>
            </Show>
        </box>
    );
}

interface ConfigurationRowProps {
    theme: Accessor<Theme>;
    configuration: Configuration;
    index: number;
    isSelected: boolean;
    status: string;
}

function ConfigurationRow(props: ConfigurationRowProps) {
    const palette = props.theme;
    const prefix = () => (props.isSelected ? "> " : "  ");
    const attrs = () => (props.isSelected ? TextAttributes.BOLD : TextAttributes.NONE);
    const fg = () => (props.isSelected ? palette().primary : palette().text);

    return (
        <box flexDirection="row">
            <text fg={fg()} attributes={attrs()}>
                {prefix()}
                {props.configuration.name} ({props.configuration.type}) - {props.configuration.host}:
                {props.configuration.port}/{props.configuration.database}
                {props.status}
            </text>
        </box>
    );
}
