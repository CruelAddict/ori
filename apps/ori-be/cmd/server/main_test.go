package main

import (
	"os"
	"testing"

	"github.com/crueladdict/ori/apps/ori-server/internal/service"
)

func TestMaxMaterializedRowsFromEnv(t *testing.T) {
	oldValue, wasSet := os.LookupEnv(maxMaterializedRowsEnv)
	if err := os.Unsetenv(maxMaterializedRowsEnv); err != nil {
		t.Fatalf("unset %s: %v", maxMaterializedRowsEnv, err)
	}
	t.Cleanup(func() {
		if wasSet {
			_ = os.Setenv(maxMaterializedRowsEnv, oldValue)
			return
		}
		_ = os.Unsetenv(maxMaterializedRowsEnv)
	})

	maxRows, err := maxMaterializedRowsFromEnv()
	if err != nil {
		t.Fatalf("maxMaterializedRowsFromEnv: %v", err)
	}
	if maxRows != service.DefaultMaxMaterializedRows {
		t.Fatalf("maxMaterializedRowsFromEnv = %d, want %d", maxRows, service.DefaultMaxMaterializedRows)
	}

	tests := []struct {
		name    string
		value   string
		want    int
		wantErr bool
	}{
		{
			name:  "uses configured value",
			value: "500",
			want:  500,
		},
		{
			name:    "rejects empty value",
			value:   "",
			wantErr: true,
		},
		{
			name:    "rejects zero",
			value:   "0",
			wantErr: true,
		},
		{
			name:    "rejects negative value",
			value:   "-1",
			wantErr: true,
		},
		{
			name:    "rejects non integer value",
			value:   "many",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(maxMaterializedRowsEnv, tt.value)
			got, err := maxMaterializedRowsFromEnv()
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("maxMaterializedRowsFromEnv: %v", err)
			}
			if got != tt.want {
				t.Fatalf("maxMaterializedRowsFromEnv = %d, want %d", got, tt.want)
			}
		})
	}
}
