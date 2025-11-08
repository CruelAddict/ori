package service

import (
	"fmt"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

// PasswordService resolves secrets based on password configuration
// For now supports plain_text only.
type PasswordService struct{}

func NewPasswordService() *PasswordService { return &PasswordService{} }

// Resolve returns the resolved password/secret for a given password config
func (ps *PasswordService) Resolve(cfg *model.PasswordConfig) (string, error) {
	if cfg == nil {
		return "", fmt.Errorf("password config is nil")
	}
	switch cfg.Type {
	case "plain_text":
		if cfg.Key == "" {
			return "", fmt.Errorf("password key cannot be empty")
		}
		return cfg.Key, nil
	default:
		return "", fmt.Errorf("unsupported password provider type: %s", cfg.Type)
	}
}
