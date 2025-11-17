import { For, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { Accessor } from "solid-js";
import type { ConfigurationSelectViewModel } from "@src/features/configuration/select/use-configuration-select";
import type { Configuration } from "@src/entities/configuration/model/configuration";
import { KeyScope } from "@src/core/services/key-scopes";
import type { KeyBinding } from "@src/core/stores/key-scopes";

export interface ConfigurationSelectorProps {
    viewModel: ConfigurationSelectViewModel;
}

export function ConfigurationSelector(props: ConfigurationSelectorProps) {
    const vm = props.viewModel;

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
            <Show when={!vm.loading()} fallback={<text>Loading configurations...</text>}>
                <Show when={!vm.error()} fallback={<text fg="red">Failed to load configurations: {vm.error()}</text>}>
                    <ConfigurationList
                        configurations={vm.configurations()}
                        isSelected={vm.isSelected}
                        rowStatus={vm.rowStatus}
                    />
                    <Show when={vm.connectBanner()}>
                        {(message: Accessor<string>) => (
                            <>
                                <box height={1} />
                                <text fg="yellow">{message()}</text>
                            </>
                        )}
                    </Show>
                </Show>
            </Show>
        </KeyScope>
    );
}

interface ConfigurationListProps {
    configurations: Configuration[];
    isSelected: (index: number) => boolean;
    rowStatus: (configuration: Configuration) => string;
}

function ConfigurationList(props: ConfigurationListProps) {
    return (
        <box flexDirection="column">
            <text attributes={TextAttributes.BOLD}>Configurations:</text>
            <box height={1} />
            <For each={props.configurations}>
                {(configuration, index) => (
                    <ConfigurationRow
                        configuration={configuration}
                        index={index()}
                        isSelected={props.isSelected(index())}
                        status={props.rowStatus(configuration)}
                    />
                )}
            </For>
            <Show when={props.configurations.length === 0}>
                <text attributes={TextAttributes.DIM}>No configurations found.</text>
            </Show>
        </box>
    );
}

interface ConfigurationRowProps {
    configuration: Configuration;
    index: number;
    isSelected: boolean;
    status: string;
}

function ConfigurationRow(props: ConfigurationRowProps) {
    const prefix = () => (props.isSelected ? "> " : "  ");
    const attrs = () => (props.isSelected ? TextAttributes.BOLD : TextAttributes.NONE);
    const fg = () => (props.isSelected ? "cyan" : undefined);

    return (
        <box flexDirection="row">
            <text fg={fg()} attributes={attrs()}>
                {prefix()}
                {props.configuration.name} ({props.configuration.type}) - {props.configuration.host}:{props.configuration.port}/
                {props.configuration.database}
                {props.status}
            </text>
        </box>
    );
}
