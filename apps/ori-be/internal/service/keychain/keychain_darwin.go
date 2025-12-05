//go:build darwin

package keychain

import (
	"fmt"
	"os/exec"
	"strings"
)

type keychainDarwin struct{}

func newKeychain() Keychain {
	return &keychainDarwin{}
}

func (kc *keychainDarwin) GetPassword(key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("keychain account is required")
	}

	args := []string{"find-generic-password", "-s", OriServiceID, "-a", key, "-w"}

	cmd := exec.Command("/usr/bin/security", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("keychain lookup failed: %w (output: %s)", err, strings.TrimSpace(string(output)))
	}

	return strings.TrimSpace(string(output)), nil
}
