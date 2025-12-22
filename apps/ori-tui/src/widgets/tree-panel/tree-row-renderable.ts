import { OptimizedBuffer, parseColor, Renderable, type RenderContext, type RenderableOptions, type RGBA } from "@opentui/core";
import { extend } from "@opentui/solid";

export type TreeRowSegment = {
    text: string;
    fg?: string;
    bg?: string;
    attributes?: number;
};

export type TreeRowRenderableOptions = RenderableOptions<TreeRowRenderable> & {
    segments: TreeRowSegment[];
    width: number;
    fg?: string;
    bg?: string;
};

type ParsedSegment = {
    text: string;
    fg: RGBA;
    bg?: RGBA;
    attributes?: number;
};

const DEFAULT_FG = parseColor("#ffffff");
const TRANSPARENT_BG = parseColor("#00000000");

const normalizeColor = (value: string | undefined, fallback?: RGBA) => {
    if (!value) return fallback;
    return parseColor(value);
};

export class TreeRowRenderable extends Renderable {
    private parsedSegments: ParsedSegment[] = [];
    private rawSegments: TreeRowSegment[] = [];
    private fallbackFg: RGBA = DEFAULT_FG;
    private fallbackBg: RGBA | undefined;

    constructor(ctx: RenderContext, options: TreeRowRenderableOptions) {
        const { segments, fg, bg, width, ...renderableOptions } = options;
        super(ctx, {
            height: 1,
            flexShrink: 0,
            buffered: true,
            ...renderableOptions,
            width: Math.max(1, width),
        });
        this.fallbackFg = normalizeColor(fg, DEFAULT_FG) ?? DEFAULT_FG;
        this.fallbackBg = normalizeColor(bg);
        this.setSegments(segments, true);
    }

    set segments(segments: TreeRowSegment[]) {
        this.setSegments(segments);
    }

    get segments() {
        return this.rawSegments;
    }

    set fg(value: string | undefined) {
        this.fallbackFg = normalizeColor(value, DEFAULT_FG) ?? DEFAULT_FG;
        this.setSegments(this.rawSegments, true);
    }

    set bg(value: string | undefined) {
        this.fallbackBg = normalizeColor(value);
        this.setSegments(this.rawSegments, true);
    }

    private setSegments(segments: TreeRowSegment[], requestRender = true) {
        this.rawSegments = segments ?? [];
        this.parsedSegments = this.rawSegments.map((segment) => ({
            text: segment.text,
            fg: normalizeColor(segment.fg, this.fallbackFg) ?? this.fallbackFg,
            bg: normalizeColor(segment.bg, this.fallbackBg),
            attributes: segment.attributes,
        }));
        if (requestRender) this.requestRender();
    }

    protected renderSelf(buffer: OptimizedBuffer) {
        let cursorX = 0;
        for (const segment of this.parsedSegments) {
            if (!segment.text || segment.text.length === 0) continue;
            buffer.drawText(segment.text, cursorX, 0, segment.fg ?? this.fallbackFg, segment.bg, segment.attributes);
            cursorX += segment.text.length;
        }
    }
}

extend({ tree_row: TreeRowRenderable });

declare global {
    namespace JSX {
        interface IntrinsicElements {
            tree_row: TreeRowRenderableOptions;
        }
    }
}
