package sqlutil

// IsSQLSelectQuery checks if a SQL query is a SELECT statement.
func IsSQLSelectQuery(query string) bool {
	for i := range len(query) {
		ch := query[i]
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			continue
		}
		return len(query) >= i+6 &&
			(query[i] == 's' || query[i] == 'S') &&
			(query[i+1] == 'e' || query[i+1] == 'E') &&
			(query[i+2] == 'l' || query[i+2] == 'L') &&
			(query[i+3] == 'e' || query[i+3] == 'E') &&
			(query[i+4] == 'c' || query[i+4] == 'C') &&
			(query[i+5] == 't' || query[i+5] == 'T')
	}
	return false
}
