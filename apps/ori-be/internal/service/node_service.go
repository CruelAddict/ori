package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

const (
	defaultEdgeLimit   = 1000
	defaultNodeIDLimit = 1000
)

var (
	ErrAdapterNotRegistered  = errors.New("no node adapter registered for configuration type")
	ErrConnectionUnavailable = errors.New("connection is not available")
	ErrNodeLimitExceeded     = errors.New("too many node IDs requested")
	ErrUnknownNode           = errors.New("requested node is not known; hydrate its parent first")
)

// NodeAdapter exposes database-specific metadata discovery capabilities.
type NodeAdapter interface {
	Bootstrap(ctx context.Context, req *NodeAdapterRequest) ([]*model.Node, error)
	Hydrate(ctx context.Context, req *NodeAdapterRequest, target *model.Node) ([]*model.Node, error)
}

// NodeAdapterRequest bundles contextual information each adapter may need.
type NodeAdapterRequest struct {
	Configuration  *model.Configuration
	ConnectionName string
	DB             *sql.DB
}

// NodeService orchestrates graph retrieval, caching, and adapter dispatch.
type NodeService struct {
	configs     *ConfigService
	connections *ConnectionService

	adaptersMu sync.RWMutex
	adapters   map[string]NodeAdapter

	graphsMu         sync.RWMutex
	connectionGraphs map[string]*connectionGraph

	inflightMu sync.Mutex
	inflight   map[hydrationKey]*sync.WaitGroup

	edgeLimit int
	idLimit   int
}

// NewNodeService builds a NodeService instance without any adapters registered.
func NewNodeService(configs *ConfigService, connections *ConnectionService) *NodeService {
	return &NodeService{
		configs:          configs,
		connections:      connections,
		adapters:         make(map[string]NodeAdapter),
		connectionGraphs: make(map[string]*connectionGraph),
		inflight:         make(map[hydrationKey]*sync.WaitGroup),
		edgeLimit:        defaultEdgeLimit,
		idLimit:          defaultNodeIDLimit,
	}
}

// RegisterAdapter binds a database type (e.g. "sqlite") to a concrete adapter.
func (ns *NodeService) RegisterAdapter(dbType string, adapter NodeAdapter) {
	if adapter == nil {
		return
	}
	dbType = strings.ToLower(strings.TrimSpace(dbType))
	if dbType == "" {
		return
	}
	ns.adaptersMu.Lock()
	defer ns.adaptersMu.Unlock()
	ns.adapters[dbType] = adapter
}

// GetNodes returns root nodes (when nodeIDs is empty) or hydrates the requested nodes.
func (ns *NodeService) GetNodes(ctx context.Context, configurationName string, nodeIDs []string) ([]*model.Node, error) {
	configurationName = strings.TrimSpace(configurationName)
	if configurationName == "" {
		return nil, fmt.Errorf("configurationName is required")
	}
	if len(nodeIDs) > ns.idLimit {
		return nil, fmt.Errorf("%w: limit %d", ErrNodeLimitExceeded, ns.idLimit)
	}
	for _, id := range nodeIDs {
		if strings.TrimSpace(id) == "" {
			return nil, fmt.Errorf("nodeIDs cannot contain empty values")
		}
	}

	cfg, err := ns.configs.ByName(configurationName)
	if err != nil {
		return nil, err
	}
	adapter, err := ns.adapterForType(cfg.Type)
	if err != nil {
		return nil, err
	}
	db, ok := ns.connections.GetConnection(configurationName)
	if !ok || db == nil {
		return nil, fmt.Errorf("%w: %s", ErrConnectionUnavailable, configurationName)
	}

	cGraph := ns.getOrCreateConnGraph(configurationName)
	req := &NodeAdapterRequest{
		Configuration:  cfg,
		ConnectionName: configurationName,
		DB:             db,
	}

	if len(nodeIDs) == 0 {
		return ns.ensureRootNodes(ctx, cGraph, adapter, req)
	}

	if !cGraph.hasRoots() {
		if _, err := ns.ensureRootNodes(ctx, cGraph, adapter, req); err != nil {
			return nil, err
		}
	}

	uniqueIDs := uniqueStrings(nodeIDs)
	for _, id := range uniqueIDs {
		if err := ns.ensureNodeAvailable(ctx, cGraph, adapter, req, id); err != nil {
			return nil, err
		}
	}

	return cGraph.snapshot(uniqueIDs)
}

func (ns *NodeService) adapterForType(dbType string) (NodeAdapter, error) {
	dbType = strings.ToLower(strings.TrimSpace(dbType))
	ns.adaptersMu.RLock()
	adapter, ok := ns.adapters[dbType]
	ns.adaptersMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrAdapterNotRegistered, dbType)
	}
	return adapter, nil
}

func (ns *NodeService) ensureRootNodes(ctx context.Context, graph *connectionGraph, adapter NodeAdapter, req *NodeAdapterRequest) ([]*model.Node, error) {
	if !graph.hasRoots() {
		nodes, err := adapter.Bootstrap(ctx, req)
		if err != nil {
			return nil, err
		}
		if len(nodes) == 0 {
			return nil, errors.New("db adapter returned no root nodes")
		}
		ns.prepareNodes(nodes)
		graph.setRootNodes(nodes)
	}

	for _, rootID := range graph.rootIDList() {
		if err := ns.ensureNodeAvailable(ctx, graph, adapter, req, rootID); err != nil {
			return nil, err
		}
	}

	return graph.rootSnapshot(), nil
}

func (ns *NodeService) ensureNodeAvailable(ctx context.Context, graph *connectionGraph, adapter NodeAdapter, req *NodeAdapterRequest, nodeID string) error {
	node, ok := graph.get(nodeID)
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnknownNode, nodeID)
	}
	if node.Hydrated {
		return nil
	}
	return ns.hydrateNode(ctx, graph, adapter, req, nodeID)
}

func (ns *NodeService) hydrateNode(ctx context.Context, graph *connectionGraph, adapter NodeAdapter, req *NodeAdapterRequest, nodeID string) error {
	key := hydrationKey{config: req.ConnectionName, node: nodeID}
	wg, owner := ns.enterHydration(key)
	if !owner {
		wg.Wait()
		return nil
	}

	node, ok := graph.get(nodeID)
	if !ok {
		ns.leaveHydration(key)
		return fmt.Errorf("%w: %s", ErrUnknownNode, nodeID)
	}
	if node.Hydrated {
		ns.leaveHydration(key)
		return nil
	}

	nodeCopy := cloneNode(node)
	nodes, err := adapter.Hydrate(ctx, req, nodeCopy)
	if err != nil {
		ns.leaveHydration(key)
		return err
	}
	if len(nodes) == 0 {
		nodes = []*model.Node{nodeCopy}
	}
	found := false
	for _, n := range nodes {
		if n != nil && n.ID == nodeID {
			n.Hydrated = true
			found = true
			break
		}
	}
	if !found {
		nodeCopy.Hydrated = true
		nodes = append(nodes, nodeCopy)
	}

	ns.prepareNodes(nodes)
	graph.upsert(nodes)
	ns.leaveHydration(key)
	return nil
}

func (ns *NodeService) enterHydration(key hydrationKey) (*sync.WaitGroup, bool) {
	ns.inflightMu.Lock()
	defer ns.inflightMu.Unlock()
	if existing, ok := ns.inflight[key]; ok {
		return existing, false
	}
	wg := &sync.WaitGroup{}
	wg.Add(1)
	ns.inflight[key] = wg
	return wg, true
}

func (ns *NodeService) leaveHydration(key hydrationKey) {
	ns.inflightMu.Lock()
	defer ns.inflightMu.Unlock()
	if wg, ok := ns.inflight[key]; ok {
		wg.Done()
		delete(ns.inflight, key)
	}
}

func (ns *NodeService) prepareNodes(nodes []*model.Node) {
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if node.Attributes == nil {
			node.Attributes = map[string]any{}
		}
		if node.Edges == nil {
			node.Edges = make(map[string]model.EdgeList)
		}
		for kind, edge := range node.Edges {
			copyItems := make([]string, len(edge.Items))
			copy(copyItems, edge.Items)
			node.Edges[kind] = model.EdgeList{Items: copyItems}
		}
	}
}

func (ns *NodeService) getOrCreateConnGraph(name string) *connectionGraph {
	ns.graphsMu.RLock()
	cGraph, ok := ns.connectionGraphs[name]
	ns.graphsMu.RUnlock()
	if ok {
		return cGraph
	}
	ns.graphsMu.Lock()
	defer ns.graphsMu.Unlock()
	if cGraph, ok = ns.connectionGraphs[name]; ok {
		return cGraph
	}
	cGraph = newGraph()
	ns.connectionGraphs[name] = cGraph
	return cGraph
}

type hydrationKey struct {
	config string
	node   string
}

type connectionGraph struct {
	mu      sync.RWMutex
	nodes   map[string]*model.Node
	rootIDs []string
}

func newGraph() *connectionGraph {
	return &connectionGraph{nodes: make(map[string]*model.Node)}
}

func (s *connectionGraph) hasRoots() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.rootIDs) > 0
}

func (s *connectionGraph) rootSnapshot() []*model.Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*model.Node, 0, len(s.rootIDs))
	for _, id := range s.rootIDs {
		if node, ok := s.nodes[id]; ok {
			result = append(result, cloneNode(node))
		}
	}
	return result
}

func (s *connectionGraph) rootIDList() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]string, len(s.rootIDs))
	copy(ids, s.rootIDs)
	return ids
}

func (s *connectionGraph) setRootNodes(nodes []*model.Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rootIDs = make([]string, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		copyNode := cloneNode(node)
		s.nodes[copyNode.ID] = copyNode
		s.rootIDs = append(s.rootIDs, copyNode.ID)
	}
}

func (s *connectionGraph) get(id string) (*model.Node, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	node, ok := s.nodes[id]
	return node, ok
}

func (s *connectionGraph) snapshot(ids []string) ([]*model.Node, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*model.Node, 0, len(ids))
	for _, id := range ids {
		node, ok := s.nodes[id]
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownNode, id)
		}
		result = append(result, cloneNode(node))
	}
	return result, nil
}

func (s *connectionGraph) upsert(nodes []*model.Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, node := range nodes {
		if node == nil {
			continue
		}
		s.nodes[node.ID] = cloneNode(node)
	}
}

func cloneNode(src *model.Node) *model.Node {
	if src == nil {
		return nil
	}
	clone := &model.Node{
		ID:       src.ID,
		Type:     src.Type,
		Name:     src.Name,
		Hydrated: src.Hydrated,
	}
	clone.Attributes = cloneAttributeMap(src.Attributes)
	clone.Edges = cloneEdgeMap(src.Edges)
	return clone
}

func cloneAttributeMap(attrs map[string]any) map[string]any {
	if len(attrs) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(attrs))
	for k, v := range attrs {
		out[k] = v
	}
	return out
}

func cloneEdgeMap(edges map[string]model.EdgeList) map[string]model.EdgeList {
	if len(edges) == 0 {
		return map[string]model.EdgeList{}
	}
	out := make(map[string]model.EdgeList, len(edges))
	for kind, edge := range edges {
		items := make([]string, len(edge.Items))
		copy(items, edge.Items)
		out[kind] = model.EdgeList{Items: items}
	}
	return out
}

func (ns *NodeService) EdgeLimit() int {
	return ns.edgeLimit
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, v := range values {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		result = append(result, v)
	}
	return result
}
