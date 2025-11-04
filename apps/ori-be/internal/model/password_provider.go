package model

import "fmt"

// PasswordProvider interface for retrieving passwords
type PasswordProvider interface {
	GetPassword(key string) (string, error)
}

// PlainTextProvider implements PasswordProvider for plain text passwords
type PlainTextProvider struct{}

// NewPlainTextProvider creates a new PlainTextProvider
func NewPlainTextProvider() *PlainTextProvider {
	return &PlainTextProvider{}
}

// GetPassword returns the password as-is (plain text)
func (p *PlainTextProvider) GetPassword(key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("password key cannot be empty")
	}
	return key, nil
}

// GetPasswordProvider returns the appropriate password provider based on type
func GetPasswordProvider(providerType string) (PasswordProvider, error) {
	switch providerType {
	case "plain_text":
		return NewPlainTextProvider(), nil
	default:
		return nil, fmt.Errorf("unsupported password provider type: %s", providerType)
	}
}
