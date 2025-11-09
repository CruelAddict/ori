package service

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/crueladdict/ori/apps/ori-server/internal/events"

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
	events  *events.Hub
	mu      sync.RWMutex
	conns   map[string]*sql.DB
}

func NewConnectionService(configService *ConfigService, eventHub *events.Hub) *ConnectionService {
	return &ConnectionService{
		configs: configService,
		events:  eventHub,
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
			cs.emitConnectionEvent(name, events.ConnectionStateConnected, fmt.Sprintf("connection '%s' ready", name), nil)
			return ConnectOutcome{Result: ConnectResultSuccess}
		}
	}

	message := fmt.Sprintf("connecting to '%s'", name)
	cs.emitConnectionEvent(name, events.ConnectionStateConnecting, message, nil)
	go cs.openInBackground(name)
	return ConnectOutcome{Result: ConnectResultConnecting, UserMessage: message}
}

func (cs *ConnectionService) openInBackground(name string) {
	ctx, cancel := context.WithTimeout(context.Background(), connectAttemptTimeout)
	defer cancel()

	cfg, err := cs.configs.ByName(name)
	if err != nil {
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", err)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", err))
		return
	}

	var (
		db      *sql.DB
		openErr error
	)

	switch cfg.Type {
	case "sqlite":
		path := cfg.Database
		if path == "" {
			openErr = fmt.Errorf("sqlite configuration '%s' missing database path", name)
			break
		}
		if !filepath.IsAbs(path) {
			base := cs.configs.ConfigBaseDir()
			path = filepath.Join(base, path)
		}
		path = filepath.Clean(path)
		db, openErr = sql.Open("sqlite", path)
	default:
		openErr = fmt.Errorf("unsupported database type: %s", cfg.Type)
	}
	if openErr != nil {
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", openErr)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", openErr))
		return
	}

	if pingErr := db.PingContext(ctx); pingErr != nil {
		_ = db.Close()
		cs.emitConnectionEvent(name, events.ConnectionStateFailed, "", pingErr)
		slog.Error("database connect failed", slog.String("configuration", name), slog.Any("err", pingErr))
		return
	}

	cs.mu.Lock()
	cs.conns[name] = db
	cs.mu.Unlock()

	slog.Info("database connected", slog.String("configuration", name), slog.String("driver", cfg.Type))
	cs.emitConnectionEvent(name, events.ConnectionStateConnected, fmt.Sprintf("connected to '%s'", name), nil)
}

func (cs *ConnectionService) emitConnectionEvent(name, state, message string, err error) {
	if cs.events == nil {
		return
	}

	payload := events.ConnectionStatePayload{
		ConfigurationName: name,
		State:             state,
	}
	if message != "" {
		payload.Message = message
	}
	if err != nil {
		payload.Error = err.Error()
		if payload.Message == "" {
			payload.Message = payload.Error
		}
	}

	cs.events.Publish(events.Event{Name: events.ConnectionStateEvent, Payload: payload})
}

func (cs *ConnectionService) GetConnection(name string) (*sql.DB, bool) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	db, ok := cs.conns[name]
	return db, ok
}
