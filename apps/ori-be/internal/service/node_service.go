package service

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

const (
	defaultEdgeLimit   = 1000
	defaultNodeIDLimit = 1000
)

var (
	ErrConnectionUnavailable = errors.New("connection is not available")
	ErrNodeLimitExceeded     = errors.New("too many node IDs requested")
	ErrUnknownNode           = errors.New("requested node is not known; hydrate its parent first")
)

// NodeService orchestrates graph retrieval, caching, and adapter dispatch.
type NodeService struct {
	configs     *ConfigService
	connections *ConnectionService

	graphsMu         sync.RWMutex
	connectionGraphs map[string]*connectionGraph

	inflightMu sync.Mutex
	inflight   map[hydrationKey]*sync.WaitGroup

	edgeLimit int
	idLimit   int
}

// NewNodeService builds a NodeService instance.
func NewNodeService(configs *ConfigService, connections *ConnectionService) *NodeService {
	return &NodeService{
		configs:          configs,
		connections:      connections,
		connectionGraphs: make(map[string]*connectionGraph),
		inflight:         make(map[hydrationKey]*sync.WaitGroup),
		edgeLimit:        defaultEdgeLimit,
		idLimit:          defaultNodeIDLimit,
	}
}

// GetNodes returns root nodes (when nodeIDs is empty) or hydrates the requested nodes.
func (ns *NodeService) GetNodes(ctx context.Context, configurationName string, nodeIDs []string) (model.Nodes, error) {
	connection, ok := ns.connections.GetConnection(configurationName)
	if !ok || connection == nil || connection.Adapter == nil {
		return nil, fmt.Errorf("%w: %s", ErrConnectionUnavailable, configurationName)
	}

	cGraph, err := ns.getOrCreateConnGraph(ctx, connection)
	if err != nil {
		return nil, err
	}

	if len(nodeIDs) == 0 {
		nodeIDs = cGraph.rootIDList()
	}

	uniqueIDs := uniqueStrings(nodeIDs)
	for _, id := range uniqueIDs {
		node, ok := cGraph.get(id)
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownNode, id)
		}
		if node.IsHydrated() {
			continue
		}
		if err := ns.hydrateNode(ctx, cGraph, connection, id); err != nil {
			return nil, err
		}
	}

	return cGraph.snapshot(uniqueIDs, ns.edgeLimit)
}

func (ns *NodeService) hydrateNode(ctx context.Context, graph *connectionGraph, handle *ConnectionHandle, nodeID string) error {
	// Ensures we're not handling the same node in separate requests
	key := hydrationKey{config: handle.Name, node: nodeID}
	wg, owner := ns.enterHydration(key)
	if !owner {
		wg.Wait()
		return nil
	}
	defer ns.leaveHydration(key)

	node, ok := graph.get(nodeID)
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnknownNode, nodeID)
	}
	if node.IsHydrated() {
		return nil
	}

	nodeCopy := cloneNode(node)
	var nodes []model.Node
	var err error

	switch nodeCopy.(type) {
	case *model.DatabaseNode, *model.SchemaNode:
		nodes, err = ns.hydrateScope(ctx, handle, nodeCopy)
	case *model.TableNode, *model.ViewNode:
		nodes, err = ns.hydrateRelation(ctx, handle, nodeCopy)
	default:
		nodeCopy.SetHydrated(true)
		nodes = []model.Node{nodeCopy}
	}

	if err != nil {
		return err
	}

	graph.upsert(nodes)
	return nil
}

func (ns *NodeService) hydrateScope(ctx context.Context, handle *ConnectionHandle, node model.Node) ([]model.Node, error) {
	scope := node.GetScope()
	if scope.Database == "" {
		return nil, fmt.Errorf("node %s missing scope", node.GetID())
	}

	relations, err := handle.Adapter.GetRelations(ctx, scope)
	if err != nil {
		return nil, err
	}

	builder := NewGraphBuilder(handle)

	childNodes := []model.Node{node}
	tableEdge := model.EdgeList{Items: make([]string, 0)}
	viewEdge := model.EdgeList{Items: make([]string, 0)}
	partitionEdges := make(map[string][]string)
	relationNodes := make(map[string]model.Node, len(relations))

	for _, rel := range relations {
		relScope := scope
		if rel.Schema != nil && *rel.Schema != "" {
			relScope.Schema = rel.Schema
		}
		relNode := builder.BuildRelationNode(relScope, rel)
		childNodes = append(childNodes, relNode)
		relationNodes[relNode.GetID()] = relNode
		if rel.Type == "table" {
			if rel.ParentTable != nil {
				parentScope := scope
				if rel.ParentSchema != nil && *rel.ParentSchema != "" {
					parentScope.Schema = rel.ParentSchema
				}
				parentRel := model.Relation{Name: *rel.ParentTable, Type: "table"}
				parentID := builder.RelationNodeID(parentScope, parentRel)
				partitionEdges[parentID] = append(partitionEdges[parentID], relNode.GetID())
			} else {
				tableEdge.Items = append(tableEdge.Items, relNode.GetID())
			}
		} else {
			viewEdge.Items = append(viewEdge.Items, relNode.GetID())
		}
	}

	for parentID, childIDs := range partitionEdges {
		parentNode := relationNodes[parentID]
		if parentNode == nil {
			continue
		}
		parentTable, ok := parentNode.(*model.TableNode)
		if !ok {
			return nil, fmt.Errorf("partition parent %s is not a table node", parentID)
		}
		parentTable.SetPartitions(model.EdgeList{Items: childIDs})
	}

	switch typed := node.(type) {
	case *model.DatabaseNode:
		typed.SetTables(tableEdge)
		typed.SetViews(viewEdge)
		typed.SetHydrated(true)
	case *model.SchemaNode:
		typed.SetTables(tableEdge)
		typed.SetViews(viewEdge)
		typed.SetHydrated(true)
	default:
		return nil, fmt.Errorf("node %s cannot hold tables/views edges", node.GetID())
	}

	return childNodes, nil
}

func (ns *NodeService) hydrateRelation(ctx context.Context, handle *ConnectionHandle, node model.Node) ([]model.Node, error) {
	scope := node.GetScope()
	if scope.Database == "" {
		return nil, fmt.Errorf("node %s missing scope", node.GetID())
	}

	var relation string
	switch typed := node.(type) {
	case *model.TableNode:
		relation = typed.RelationName()
	case *model.ViewNode:
		relation = typed.RelationName()
	default:
		return nil, fmt.Errorf("node %s is not a relation node", node.GetID())
	}
	if relation == "" {
		return nil, fmt.Errorf("relation node %s missing relation name", node.GetID())
	}

	columns, err := handle.Adapter.GetColumns(ctx, scope, relation)
	if err != nil {
		return nil, err
	}

	constraints, err := handle.Adapter.GetConstraints(ctx, scope, relation)
	if err != nil {
		return nil, err
	}

	indexes, err := handle.Adapter.GetIndexes(ctx, scope, relation)
	if err != nil {
		return nil, err
	}

	triggers, err := handle.Adapter.GetTriggers(ctx, scope, relation)
	if err != nil {
		return nil, err
	}

	builder := NewGraphBuilder(handle)

	columnNodes, columnEdge := builder.BuildColumnNodes(scope, relation, columns)
	constraintNodes, constraintEdge := builder.BuildConstraintNodes(scope, relation, constraints)
	indexNodes, indexEdge := builder.BuildIndexNodes(scope, relation, indexes)
	triggerNodes, triggerEdge := builder.BuildTriggerNodes(scope, relation, triggers)

	switch typed := node.(type) {
	case *model.TableNode:
		typed.SetColumns(columnEdge)
		typed.SetConstraints(constraintEdge)
		typed.SetIndexes(indexEdge)
		typed.SetTriggers(triggerEdge)
		typed.SetHydrated(true)
	case *model.ViewNode:
		typed.SetColumns(columnEdge)
		typed.SetConstraints(constraintEdge)
		typed.SetIndexes(indexEdge)
		typed.SetTriggers(triggerEdge)
		typed.SetHydrated(true)
	default:
		return nil, fmt.Errorf("node %s cannot hold relation child edges", node.GetID())
	}

	nodes := []model.Node{node}
	nodes = append(nodes, columnNodes...)
	nodes = append(nodes, constraintNodes...)
	nodes = append(nodes, indexNodes...)
	nodes = append(nodes, triggerNodes...)

	return nodes, nil
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

func (ns *NodeService) getOrCreateConnGraph(ctx context.Context, connection *ConnectionHandle) (*connectionGraph, error) {
	name := connection.Name
	ns.graphsMu.RLock()
	graph, ok := ns.connectionGraphs[name]
	ns.graphsMu.RUnlock()
	if ok {
		return graph, nil
	}
	ns.graphsMu.Lock()
	defer ns.graphsMu.Unlock()
	if graph, ok = ns.connectionGraphs[name]; ok {
		return graph, nil
	}
	graph, err := ns.createConnGraph(ctx, connection)
	if err != nil {
		return graph, err
	}

	ns.connectionGraphs[name] = graph
	return graph, nil
}

func (ns *NodeService) createConnGraph(ctx context.Context, connection *ConnectionHandle) (*connectionGraph, error) {
	graph := &connectionGraph{nodes: make(map[string]model.Node)}

	scopes, err := connection.Adapter.GetScopes(ctx)
	if err != nil {
		return nil, err
	}
	if len(scopes) == 0 {
		return nil, fmt.Errorf("no scopes found for configuration '%s'", connection.Name)
	}

	builder := NewGraphBuilder(connection)
	nodes := make([]model.Node, 0, len(scopes))
	for _, scope := range scopes {
		nodes = append(nodes, builder.BuildScopeNode(scope))
	}

	graph.setRootNodes(nodes)

	return graph, nil
}

type hydrationKey struct {
	config string
	node   string
}

type connectionGraph struct {
	mu      sync.RWMutex
	nodes   map[string]model.Node
	rootIDs []string
}

func (s *connectionGraph) rootIDList() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]string, len(s.rootIDs))
	copy(ids, s.rootIDs)
	return ids
}

func (s *connectionGraph) setRootNodes(nodes []model.Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rootIDs = make([]string, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		copyNode := cloneNode(node)
		s.nodes[copyNode.GetID()] = copyNode
		s.rootIDs = append(s.rootIDs, copyNode.GetID())
	}
}

func (s *connectionGraph) get(id string) (model.Node, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	node, ok := s.nodes[id]
	return node, ok
}

func (s *connectionGraph) snapshot(ids []string, edgeLimit int) (model.Nodes, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(model.Nodes, 0, len(ids))
	for _, id := range ids {
		node, ok := s.nodes[id]
		if !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownNode, id)
		}
		result = append(result, cloneNodeWithEdgeLimit(node, edgeLimit))
	}
	return result, nil
}

func (s *connectionGraph) upsert(nodes []model.Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, node := range nodes {
		if node == nil {
			continue
		}
		s.nodes[node.GetID()] = cloneNode(node)
	}
}

func cloneNode(src model.Node) model.Node {
	return cloneNodeWithEdgeLimit(src, 0)
}

func cloneNodeWithEdgeLimit(src model.Node, edgeLimit int) model.Node {
	if src == nil {
		return nil
	}
	return src.Clone(edgeLimit)
}

func cloneEdgeMap(edges map[string]model.EdgeList, edgeLimit int) map[string]model.EdgeList {
	if len(edges) == 0 {
		return map[string]model.EdgeList{}
	}
	out := make(map[string]model.EdgeList, len(edges))
	for kind, edge := range edges {
		total := len(edge.Items)
		max := total
		if edgeLimit > 0 && edgeLimit < total {
			max = edgeLimit
		}
		items := make([]string, max)
		copy(items, edge.Items[:max])
		out[kind] = model.EdgeList{Items: items, Truncated: edge.Truncated || total > max}
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
