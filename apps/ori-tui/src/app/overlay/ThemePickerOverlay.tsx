import { createMemo, onCleanup } from "solid-js";
import type { OverlayComponentProps } from "@app/overlay/overlay-store";
import { useTheme } from "@app/providers/theme";
import { DialogSelect, useDialogSelect, type DialogSelectOption } from "@widgets/dialog-select";

export function ThemePickerOverlay(props: OverlayComponentProps) {
    const { availableThemes, selectedTheme, setTheme } = useTheme();
    const initialTheme = selectedTheme();

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

    let previewTimeout: ReturnType<typeof setTimeout> | undefined;
    let overlayClosed = false;

    const clearPreviewTimeout = () => {
        if (!previewTimeout) return;
        clearTimeout(previewTimeout);
        previewTimeout = undefined;
    };

    const handleHighlightChange = (option?: DialogSelectOption<string>) => {
        clearPreviewTimeout();
        const scheduledTheme = option?.value ?? initialTheme;
        previewTimeout = setTimeout(() => {
            previewTimeout = undefined;
            if (overlayClosed) return;
            if (selectedTheme() !== scheduledTheme) {
                setTheme(scheduledTheme);
            }
        }, 100);
    };

    const handleCancel = () => {
        overlayClosed = true;
        clearPreviewTimeout();
        if (selectedTheme() !== initialTheme) {
            setTheme(initialTheme);
        }
        props.close();
    };

    const handleSelect = (option: DialogSelectOption<string>) => {
        overlayClosed = true;
        clearPreviewTimeout();
        setTheme(option.value);
        props.close();
    };

    onCleanup(() => {
        overlayClosed = true;
        clearPreviewTimeout();
    });

    return (
        <DialogSelect
            title="Themes"
            placeholder="Search themes"
            width={60}
            maxHeight={Math.min(availableThemes.length + 2, 16)}
            viewModel={viewModel}
            onSelect={handleSelect}
            onCancel={handleCancel}
            onHighlightChange={handleHighlightChange}
        />
    );
}
