package stringutil

import (
	"fmt"
	"strings"
	"unicode"
)

// Slug creates a URL-safe identifier from parts.
func Slug(parts ...string) string {
	var tokens []string
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		var b strings.Builder
		lastDash := false
		for _, r := range strings.ToLower(p) {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				b.WriteRune(r)
				lastDash = false
				continue
			}
			if !lastDash {
				b.WriteRune('-')
				lastDash = true
			}
		}
		token := strings.Trim(b.String(), "-")
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	if len(tokens) == 0 {
		return "node"
	}
	return strings.Join(tokens, "-")
}

// EscapeIdentifier escapes a SQL identifier (double-quote escaping).
func EscapeIdentifier(input string) string {
	return strings.ReplaceAll(input, "\"", "\"\"")
}

// QuoteLiteral escapes a string literal for SQL (single-quote escaping).
func QuoteLiteral(input string) string {
	return fmt.Sprintf("'%s'", strings.ReplaceAll(input, "'", "''"))
}

// CopyStrings creates a copy of a string slice.
func CopyStrings(src []string) []string {
	if len(src) == 0 {
		return nil
	}
	dst := make([]string, len(src))
	copy(dst, src)
	return dst
}
