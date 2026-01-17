package sqlutil

import "strings"

var nonRowKeywords = map[string]struct{}{
	"ALTER":    {},
	"ANALYZE":  {},
	"BEGIN":    {},
	"COMMIT":   {},
	"COPY":     {},
	"CREATE":   {},
	"DELETE":   {},
	"DROP":     {},
	"END":      {},
	"GRANT":    {},
	"INSERT":   {},
	"REVOKE":   {},
	"ROLLBACK": {},
	"SET":      {},
	"TRUNCATE": {},
	"UPDATE":   {},
	"VACUUM":   {},
}

// IsRowReturningQuery returns true unless the query is clearly non-row.
func IsRowReturningQuery(query string) bool {
	keyword := firstKeyword(query)
	if keyword == "" {
		return false
	}
	_, isNonRow := nonRowKeywords[keyword]
	return !isNonRow
}

func firstKeyword(query string) string {
	length := len(query)
	index := 0
	for index < length {
		char := query[index]
		if isWhitespace(char) {
			index++
			continue
		}
		if char == '-' && index+1 < length && query[index+1] == '-' {
			index += 2
			for index < length && query[index] != '\n' {
				index++
			}
			continue
		}
		if char == '/' && index+1 < length && query[index+1] == '*' {
			index += 2
			for index+1 < length {
				if query[index] == '*' && query[index+1] == '/' {
					index += 2
					break
				}
				index++
			}
			continue
		}
		break
	}
	if index >= length {
		return ""
	}
	start := index
	for index < length {
		char := query[index]
		if !isKeywordChar(char) {
			break
		}
		index++
	}
	if start == index {
		return ""
	}
	return strings.ToUpper(query[start:index])
}

func isWhitespace(char byte) bool {
	return char == ' ' || char == '\t' || char == '\n' || char == '\r'
}

func isKeywordChar(char byte) bool {
	return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')
}
