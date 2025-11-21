const HEX_PATTERN = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function withAlpha(hexColor: string, alpha: number): string {
    if (!HEX_PATTERN.test(hexColor)) {
        throw new Error(`Invalid hex color provided: ${hexColor}`);
    }

    const normalized = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
    const rgbPart = normalized.slice(0, 6);
    const clampedAlpha = clamp(alpha, 0, 1);
    const alphaComponent = Math.round(clampedAlpha * 255)
        .toString(16)
        .padStart(2, "0");

    return `#${rgbPart}${alphaComponent}`;
}
