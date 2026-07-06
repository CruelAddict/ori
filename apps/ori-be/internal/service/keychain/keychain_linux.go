//go:build linux

package keychain

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const linuxProviderEnv = "ORI_KEYCHAIN_PROVIDER"

type linuxProvider string

const (
	linuxProviderAuto          linuxProvider = "auto"
	linuxProviderSecretService linuxProvider = "secret-service"
	linuxProviderPass          linuxProvider = "pass"
	linuxProviderNone          linuxProvider = "none"
)

type keychainLinux struct {
	provider linuxProvider
	invalid  string
}

func newKeychain() Keychain {
	provider, invalid := normalizeLinuxProvider(os.Getenv(linuxProviderEnv))
	return &keychainLinux{provider: provider, invalid: invalid}
}

func normalizeLinuxProvider(value string) (linuxProvider, string) {
	provider := strings.ToLower(strings.TrimSpace(value))
	switch provider {
	case "", "auto":
		return linuxProviderAuto, ""
	case "secret-service", "secretservice", "secret-tool", "libsecret":
		return linuxProviderSecretService, ""
	case "pass":
		return linuxProviderPass, ""
	case "none", "disabled", "off":
		return linuxProviderNone, ""
	default:
		return linuxProviderNone, fmt.Sprintf("unsupported Linux keychain provider %q in %s", value, linuxProviderEnv)
	}
}

func (kc *keychainLinux) GetPassword(key string) (string, error) {
	if key == "" {
		return "", fmt.Errorf("keychain account is required")
	}
	if kc.invalid != "" {
		return "", fmt.Errorf("%s; expected auto, secret-service, pass, or none", kc.invalid)
	}

	switch kc.provider {
	case linuxProviderAuto:
		return kc.getAutoPassword(key)
	case linuxProviderSecretService:
		return kc.getSecretServicePassword(key)
	case linuxProviderPass:
		return kc.getPassPassword(key)
	case linuxProviderNone:
		return "", fmt.Errorf("linux keychain provider is disabled by %s", linuxProviderEnv)
	default:
		return "", fmt.Errorf("unsupported Linux keychain provider %q", kc.provider)
	}
}

func (kc *keychainLinux) getAutoPassword(key string) (string, error) {
	failures := make([]string, 0, 2)
	if err := secretServiceReady(); err == nil {
		secret, err := kc.getSecretServicePassword(key)
		if err == nil {
			return secret, nil
		}
		failures = append(failures, fmt.Sprintf("secret-service: %v", err))
	} else {
		failures = append(failures, fmt.Sprintf("secret-service unavailable: %v", err))
	}

	if commandExists("pass") {
		secret, err := kc.getPassPassword(key)
		if err == nil {
			return secret, nil
		}
		failures = append(failures, fmt.Sprintf("pass: %v", err))
	} else {
		failures = append(failures, "pass unavailable: pass not found")
	}

	return "", fmt.Errorf(
		"linux keychain lookup failed for account %q: %s; install libsecret-tools/gnome-keyring or pass, set %s=secret-service|pass, or use plain_text/shell",
		key,
		strings.Join(failures, "; "),
		linuxProviderEnv,
	)
}

func (kc *keychainLinux) getSecretServicePassword(key string) (string, error) {
	if err := secretServiceReady(); err != nil {
		return "", err
	}

	cmd := exec.Command("secret-tool", "lookup", "service", OriServiceID, "account", key)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("secret-tool lookup failed: %w (output: %s)", err, strings.TrimSpace(string(output)))
	}

	secret := strings.TrimSpace(string(output))
	if secret == "" {
		return "", fmt.Errorf("secret service entry not found for account %q", key)
	}
	return secret, nil
}

func (kc *keychainLinux) getPassPassword(key string) (string, error) {
	if !commandExists("pass") {
		return "", fmt.Errorf("pass not found")
	}

	entry := OriServiceID + "/" + strings.Trim(key, "/")
	cmd := exec.Command("pass", "show", entry)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("pass show %q failed: %w (output: %s)", entry, err, strings.TrimSpace(string(output)))
	}

	secret := strings.TrimSpace(string(output))
	if secret == "" {
		return "", fmt.Errorf("pass entry %q is empty", entry)
	}
	line, _, _ := strings.Cut(secret, "\n")
	return strings.TrimSpace(line), nil
}

func secretServiceReady() error {
	if !commandExists("secret-tool") {
		return fmt.Errorf("secret-tool not found")
	}
	if os.Getenv("DBUS_SESSION_BUS_ADDRESS") == "" {
		return fmt.Errorf("DBUS_SESSION_BUS_ADDRESS is not set")
	}
	return nil
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
