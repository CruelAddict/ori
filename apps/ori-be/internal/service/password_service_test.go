package service

import (
	"errors"
	"strings"
	"testing"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

type fakeKeychainClient struct {
	secret string
	err    error
	last   string
}

// TODO: change to mockery
func (f *fakeKeychainClient) GetPassword(req string) (string, error) {
	f.last = req
	if f.err != nil {
		return "", f.err
	}
	return f.secret, nil
}

func TestResolvePlainText(t *testing.T) {
	svc := &PasswordService{keychainClient: &fakeKeychainClient{}}

	secret, err := svc.Resolve(&model.PasswordConfig{Type: "plain_text", Key: "secret123"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if secret != "secret123" {
		t.Fatalf("expected secret123, got %s", secret)
	}
}

func TestResolveShellSuccess(t *testing.T) {
	svc := &PasswordService{keychainClient: &fakeKeychainClient{}}

	secret, err := svc.Resolve(&model.PasswordConfig{Type: "shell", Key: "echo shell-secret"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if secret != "shell-secret" {
		t.Fatalf("expected shell-secret, got %s", secret)
	}
}

func TestResolveShellFailure(t *testing.T) {
	svc := &PasswordService{keychainClient: &fakeKeychainClient{}}

	_, err := svc.Resolve(&model.PasswordConfig{Type: "shell", Key: "exit 1"})
	if err == nil {
		t.Fatalf("expected error for failing shell command")
	}
}

func TestResolveKeychain(t *testing.T) {
	fake := &fakeKeychainClient{secret: "kc-secret"}
	svc := &PasswordService{keychainClient: fake}

	secret, err := svc.Resolve(&model.PasswordConfig{Type: "keychain", Key: "account-name"})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if secret != "kc-secret" {
		t.Fatalf("expected kc-secret, got %s", secret)
	}
}

func TestResolveKeychainUnsupported(t *testing.T) {
	fake := &fakeKeychainClient{err: errors.New("unsupported")}
	svc := &PasswordService{keychainClient: fake}

	_, err := svc.Resolve(&model.PasswordConfig{Type: "keychain", Key: "account-name"})
	if err == nil {
		t.Fatalf("expected error for unsupported keychain")
	}
	if !strings.Contains(err.Error(), "unsupported") {
		t.Fatalf("expected wrapped unsupported error, got %v", err)
	}
}
