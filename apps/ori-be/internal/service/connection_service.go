package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type ConnectOutcome struct {
	Result      string
	UserMessage string
}

const (
	ConnectResultSuccess    = "success"
	ConnectResultFail       = "fail"
	ConnectResultConnecting = "connecting"
)

const connectAttemptTimeout = 30 * time.Second

type ConnectionService struct {
	configs *ConfigService
	mu      sync.RWMutex
	conns   map[string]*sql.DB
}

func NewConnectionService(configService *ConfigService) *ConnectionService {
	return &ConnectionService{
		configs: configService,
		conns:   make(map[string]*sql.DB),
	}
}

func (cs *ConnectionService) Connect(ctx context.Context, name string) ConnectOutcome {
	db, ok := cs.GetConnection(name)

	if ok && db != nil {
		pingCtx, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
		defer cancel()
		if err := db.PingContext(pingCtx); err != nil {
			cs.mu.Lock()
			_ = db.Close()
			delete(cs.conns, name)
			cs.mu.Unlock()
		} else {
			return ConnectOutcome{Result: ConnectResultSuccess}
		}
	}

	go cs.openInBackground(name)
	return ConnectOutcome{Result: ConnectResultConnecting, UserMessage: fmt.Sprintf("connecting to '%s'", name)}
}

func (cs *ConnectionService) openInBackground(name string) {
	ctx, cancel := context.WithTimeout(context.Background(), connectAttemptTimeout)
	defer cancel()
	var err error
	defer func() {
		if err != nil {
			slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", err))
		}
		return
	}()

	cfg, err := cs.configs.ByName(name)
	if err != nil {
		return
	}

	var db *sql.DB
	switch cfg.Type {
	case "sqlite":
		// For sqlite we treat Database as a file path; if relative, resolve vs. config base dir
		path := cfg.Database
		if path == "" {
			return
		}
		if !filepath.IsAbs(path) {
			base := cs.configs.ConfigBaseDir()
			path = filepath.Join(base, path)
		}
		path = filepath.Clean(path)
		// modernc driver name is "sqlite"
		db, err = sql.Open("sqlite", path)
	default:
		err = fmt.Errorf("unsupported database type: %s", cfg.Type)
	}
	if err != nil {
		return
	}

	// Verify and cache
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return
	}

	cs.mu.Lock()
	cs.conns[name] = db
	cs.mu.Unlock()

	slog.Info("database connected", slog.String("configuration", name), slog.String("driver", cfg.Type))
}

func (cs *ConnectionService) GetConnection(name string) (*sql.DB, bool) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	db, ok := cs.conns[name]
	return db, ok
}
