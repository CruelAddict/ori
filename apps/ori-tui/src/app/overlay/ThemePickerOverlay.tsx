import { For, Show, createSignal } from "solid-js";
import { createMemo } from "solid-js";
import type { OverlayComponentProps } from "@app/overlay/overlay-store";
import { useTheme } from "@app/providers/theme";
import { DialogSelect, useDialogSelect, type DialogSelectOption } from "@widgets/dialog-select";

export function ThemePickerOverlay(props: OverlayComponentProps) {
    const { availableThemes, selectedTheme, setTheme } = useTheme();

    const options = createMemo<DialogSelectOption<string>[]>(() =>
        availableThemes.map((entry) => ({
            id: entry.name,
            title: entry.label,
            value: entry.name,
        }))
    );

    const viewModel = useDialogSelect({
        options,
        selectedValue: selectedTheme,
        equals: (a, b) => a === b,
        limit: availableThemes.length,
        pageSize: 5,
    });

    const handleSelect = (option: DialogSelectOption<string>) => {
        setTheme(option.value);
        props.close();
    };

    return (
        <DialogSelect
            title="Themes"
            placeholder="Search themes"
            width={70}
            maxHeight={Math.min(availableThemes.length + 2, 16)}
            viewModel={viewModel}
            onSelect={handleSelect}
            onCancel={props.close}
        />
    );
}
