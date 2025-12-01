package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func decodeJSON(body io.ReadCloser, dest interface{}) error {
	defer func() {
		_ = body.Close()
	}()

	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

func decodePathParam(r *http.Request, key string) (string, error) {
	raw := strings.TrimSpace(r.PathValue(key))
	if raw == "" {
		return "", fmt.Errorf("missing %s", key)
	}

	value, err := url.PathUnescape(raw)
	if err != nil {
		return "", fmt.Errorf("invalid path segment %q: %w", raw, err)
	}

	return value, nil
}

func optionalInt(value string, min int) (*int, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}

	num, err := strconv.Atoi(value)
	if err != nil {
		return nil, err
	}
	if min >= 0 && num < min {
		return nil, fmt.Errorf("value must be >= %d", min)
	}

	return &num, nil
}
