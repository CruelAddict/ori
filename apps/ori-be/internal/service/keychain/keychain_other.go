//go:build !darwin

package keychain

import "fmt"

type keychainOther struct{}

func newSystemClient() Keychain {
	return &keychainOther{}
}

func (kc *keychainOther) GetPassword(key string) (string, error) {
	return "", fmt.Errorf("macOS keychain passwords are only supported on darwin")
}
