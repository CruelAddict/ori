//go:build !darwin && !linux

package keychain

import (
	"fmt"
	"runtime"
)

type keychainOther struct{}

func newKeychain() Keychain {
	return &keychainOther{}
}

func (kc *keychainOther) GetPassword(key string) (string, error) {
	return "", fmt.Errorf("keychain passwords are not supported on %s", runtime.GOOS)
}
