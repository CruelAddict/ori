package logctx

import (
	"context"
	"log/slog"
)

type ctxKey struct{}

// WithAttrs appends the provided attributes to the context.
func WithAttrs(ctx context.Context, attrs ...slog.Attr) context.Context {
	if len(attrs) == 0 {
		return ctx
	}
	combined := make([]slog.Attr, 0, len(attrs))
	if existing := attrsFromContext(ctx); len(existing) > 0 {
		combined = append(combined, existing...)
	}
	combined = append(combined, attrs...)
	return context.WithValue(ctx, ctxKey{}, combined)
}

// WithField adds a single key/value attribute to the context.
func WithField(ctx context.Context, key string, value any) context.Context {
	return WithAttrs(ctx, slog.Any(key, value))
}

// WithFields adds a set of key/value attributes to the context.
func WithFields(ctx context.Context, fields map[string]any) context.Context {
	if len(fields) == 0 {
		return ctx
	}
	attrs := make([]slog.Attr, 0, len(fields))
	for key, value := range fields {
		attrs = append(attrs, slog.Any(key, value))
	}
	return WithAttrs(ctx, attrs...)
}

// AttrsToArgs converts attributes to arguments for InfoContext-style APIs.
func AttrsToArgs(attrs []slog.Attr) []any {
	if len(attrs) == 0 {
		return nil
	}
	args := make([]any, 0, len(attrs))
	for _, attr := range attrs {
		args = append(args, attr)
	}
	return args
}

// Attrs returns the attributes stored in the context.
func Attrs(ctx context.Context) []slog.Attr {
	return attrsFromContext(ctx)
}

func attrsFromContext(ctx context.Context) []slog.Attr {
	value := ctx.Value(ctxKey{})
	attrs, ok := value.([]slog.Attr)
	if ok {
		return attrs
	}
	return nil
}

// WrapLogger returns a logger that injects context attributes on every record.
func WrapLogger(logger *slog.Logger) *slog.Logger {
	if logger == nil {
		return nil
	}
	return slog.New(NewContextHandler(logger.Handler()))
}
