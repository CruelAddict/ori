package keychain

// Keychain fetches secrets from the OS keychain implementation.
type Keychain interface {
	GetPassword(key string) (string, error)
}

const OriServiceID = "ori.db"

// NewKeychain returns a platform specific keychain client.
func NewKeychain() Keychain {
	return newKeychain()
}
