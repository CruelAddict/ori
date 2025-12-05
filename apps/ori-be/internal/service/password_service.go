package service

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/service/keychain"
)

// PasswordService resolves secrets based on password configuration
type PasswordService struct {
	keychainClient keychain.Keychain
}

func NewPasswordService() *PasswordService {
	return &PasswordService{keychainClient: keychain.NewKeychain()}
}

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
	case "shell":
		return ps.resolveShell(cfg.Key)
	case "keychain":
		return ps.resolveKeychain(cfg.Key)
	default:
		return "", fmt.Errorf("unsupported password provider type: %s", cfg.Type)
	}
}

func (ps *PasswordService) resolveShell(command string) (string, error) {
	if strings.TrimSpace(command) == "" {
		return "", fmt.Errorf("shell password command cannot be empty")
	}

	cmd := exec.Command("/bin/sh", "-c", command)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("shell password command failed: %w (output: %s)", err, strings.TrimSpace(string(output)))
	}

	return strings.TrimSpace(string(output)), nil
}

func (ps *PasswordService) resolveKeychain(account string) (string, error) {
	if strings.TrimSpace(account) == "" {
		return "", fmt.Errorf("keychain account cannot be empty")
	}

	secret, err := ps.keychainClient.GetPassword(account)
	if err != nil {
		return "", fmt.Errorf("keychain lookup failed: %w", err)
	}

	return strings.TrimSpace(secret), nil
}
