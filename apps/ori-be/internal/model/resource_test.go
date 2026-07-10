package model

import (
	"encoding/json"
	"testing"
)

func TestResourceAutoLimitRowsUnmarshal(t *testing.T) {
	tests := []struct {
		name string
		body string
		want *int
	}{
		{
			name: "defaults when absent",
			body: `{"name":"local","type":"sqlite","database":"./db.sqlite"}`,
			want: ptr(DefaultAutoLimitRows),
		},
		{
			name: "disables when null",
			body: `{"name":"local","type":"sqlite","database":"./db.sqlite","autoLimitRows":null}`,
			want: nil,
		},
		{
			name: "uses configured value",
			body: `{"name":"local","type":"sqlite","database":"./db.sqlite","autoLimitRows":1000}`,
			want: ptr(1000),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var resource Resource
			if err := json.Unmarshal([]byte(tt.body), &resource); err != nil {
				t.Fatalf("unmarshal resource: %v", err)
			}
			if !equalPtr(resource.AutoLimitRows, tt.want) {
				t.Fatalf("AutoLimitRows = %v, want %v", resource.AutoLimitRows, tt.want)
			}
		})
	}
}

func ptr(value int) *int {
	return &value
}

func equalPtr(left, right *int) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}
