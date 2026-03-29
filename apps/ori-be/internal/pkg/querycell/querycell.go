package querycell

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"time"
	"unicode/utf8"
)

func Stringify(value any) any {
	if value == nil {
		return nil
	}

	switch v := value.(type) {
	case string:
		return v
	case []byte:
		if utf8.Valid(v) {
			return string(v)
		}
		return hex.EncodeToString(v)
	case time.Time:
		return v.Format(time.RFC3339Nano)
	case fmt.Stringer:
		return v.String()
	case bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64:
		return fmt.Sprint(v)
	}

	rv := reflect.ValueOf(value)
	for rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}

	switch rv.Kind() {
	case reflect.Map, reflect.Slice, reflect.Array, reflect.Struct:
		if payload, err := json.Marshal(value); err == nil {
			return string(payload)
		}
	}

	return fmt.Sprint(value)
}
