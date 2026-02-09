package model

import (
	dto "github.com/crueladdict/ori/libs/contract/go"
)

// EdgeList captures outgoing relationships for a node grouped by an edge kind.
type EdgeList struct {
	Items     []string
	Truncated bool
}

// Node is the common graph node interface used by services and storage.
type Node interface {
	GetID() string
	GetName() string
	GetScope() ScopeID
	GetEdges() map[string]EdgeList
	IsHydrated() bool
	SetHydrated(value bool)
	Clone(edgeLimit int) Node
	ToDTO() (dto.Node, error)
}

const (
	EdgeTables      = "tables"
	EdgeViews       = "views"
	EdgePartitions  = "partitions"
	EdgeColumns     = "columns"
	EdgeConstraints = "constraints"
	EdgeIndexes     = "indexes"
	EdgeTriggers    = "triggers"
)

// Nodes is a typed list of graph nodes.
type Nodes []Node

type BaseNode struct {
	ID       string
	Name     string
	Scope    ScopeID
	Hydrated bool
}

func (n *BaseNode) GetID() string {
	if n == nil {
		return ""
	}
	return n.ID
}

func (n *BaseNode) GetName() string {
	if n == nil {
		return ""
	}
	return n.Name
}

func (n *BaseNode) GetScope() ScopeID {
	if n == nil {
		return ScopeID{}
	}
	return cloneScope(n.Scope)
}

func (n *BaseNode) GetEdges() map[string]EdgeList {
	if n == nil {
		return nil
	}
	return map[string]EdgeList{}
}

func (n *BaseNode) IsHydrated() bool {
	if n == nil {
		return false
	}
	return n.Hydrated
}

func (n *BaseNode) SetHydrated(value bool) {
	if n == nil {
		return
	}
	n.Hydrated = value
}

func (n *BaseNode) cloneBase() BaseNode {
	if n == nil {
		return BaseNode{}
	}
	return BaseNode{
		ID:       n.ID,
		Name:     n.Name,
		Scope:    cloneScope(n.Scope),
		Hydrated: n.Hydrated,
	}
}

type DatabaseNode struct {
	BaseNode
	Attributes dto.DatabaseNodeAttributes
	Tables     *EdgeList
	Views      *EdgeList
}

func (n *DatabaseNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneDatabaseAttributes(n.Attributes)
	clone.Tables = cloneEdgeWithLimit(n.Tables, edgeLimit)
	clone.Views = cloneEdgeWithLimit(n.Views, edgeLimit)
	return &clone
}

func (n *DatabaseNode) GetEdges() map[string]EdgeList {
	if n == nil {
		return nil
	}
	return edgesFromEntries(
		edgeEntry{kind: EdgeTables, edge: n.Tables},
		edgeEntry{kind: EdgeViews, edge: n.Views},
	)
}

func (n *DatabaseNode) SetTables(edge EdgeList) {
	if n == nil {
		return
	}
	n.Tables = cloneEdgePointer(edge)
}

func (n *DatabaseNode) SetViews(edge EdgeList) {
	if n == nil {
		return
	}
	n.Views = cloneEdgePointer(edge)
}

type SchemaNode struct {
	BaseNode
	Attributes dto.SchemaNodeAttributes
	Tables     *EdgeList
	Views      *EdgeList
}

func (n *SchemaNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = n.Attributes
	clone.Tables = cloneEdgeWithLimit(n.Tables, edgeLimit)
	clone.Views = cloneEdgeWithLimit(n.Views, edgeLimit)
	return &clone
}

func (n *SchemaNode) GetEdges() map[string]EdgeList {
	if n == nil {
		return nil
	}
	return edgesFromEntries(
		edgeEntry{kind: EdgeTables, edge: n.Tables},
		edgeEntry{kind: EdgeViews, edge: n.Views},
	)
}

func (n *SchemaNode) SetTables(edge EdgeList) {
	if n == nil {
		return
	}
	n.Tables = cloneEdgePointer(edge)
}

func (n *SchemaNode) SetViews(edge EdgeList) {
	if n == nil {
		return
	}
	n.Views = cloneEdgePointer(edge)
}

type TableNode struct {
	BaseNode
	Attributes  dto.TableNodeAttributes
	Partitions  *EdgeList
	Columns     *EdgeList
	Constraints *EdgeList
	Indexes     *EdgeList
	Triggers    *EdgeList
}

func (n *TableNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneTableAttributes(n.Attributes)
	clone.Partitions = cloneEdgeWithLimit(n.Partitions, edgeLimit)
	clone.Columns = cloneEdgeWithLimit(n.Columns, edgeLimit)
	clone.Constraints = cloneEdgeWithLimit(n.Constraints, edgeLimit)
	clone.Indexes = cloneEdgeWithLimit(n.Indexes, edgeLimit)
	clone.Triggers = cloneEdgeWithLimit(n.Triggers, edgeLimit)
	return &clone
}

func (n *TableNode) GetEdges() map[string]EdgeList {
	if n == nil {
		return nil
	}
	return edgesFromEntries(
		edgeEntry{kind: EdgePartitions, edge: n.Partitions},
		edgeEntry{kind: EdgeColumns, edge: n.Columns},
		edgeEntry{kind: EdgeConstraints, edge: n.Constraints},
		edgeEntry{kind: EdgeIndexes, edge: n.Indexes},
		edgeEntry{kind: EdgeTriggers, edge: n.Triggers},
	)
}

func (n *TableNode) SetPartitions(edge EdgeList) {
	if n == nil {
		return
	}
	n.Partitions = cloneEdgePointer(edge)
}

func (n *TableNode) SetColumns(edge EdgeList) {
	if n == nil {
		return
	}
	n.Columns = cloneEdgePointer(edge)
}

func (n *TableNode) SetConstraints(edge EdgeList) {
	if n == nil {
		return
	}
	n.Constraints = cloneEdgePointer(edge)
}

func (n *TableNode) SetIndexes(edge EdgeList) {
	if n == nil {
		return
	}
	n.Indexes = cloneEdgePointer(edge)
}

func (n *TableNode) SetTriggers(edge EdgeList) {
	if n == nil {
		return
	}
	n.Triggers = cloneEdgePointer(edge)
}

func (n *TableNode) RelationName() string {
	if n == nil {
		return ""
	}
	return n.Attributes.Table
}

type ViewNode struct {
	BaseNode
	Attributes  dto.ViewNodeAttributes
	Columns     *EdgeList
	Constraints *EdgeList
	Indexes     *EdgeList
	Triggers    *EdgeList
}

func (n *ViewNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneViewAttributes(n.Attributes)
	clone.Columns = cloneEdgeWithLimit(n.Columns, edgeLimit)
	clone.Constraints = cloneEdgeWithLimit(n.Constraints, edgeLimit)
	clone.Indexes = cloneEdgeWithLimit(n.Indexes, edgeLimit)
	clone.Triggers = cloneEdgeWithLimit(n.Triggers, edgeLimit)
	return &clone
}

func (n *ViewNode) GetEdges() map[string]EdgeList {
	if n == nil {
		return nil
	}
	return edgesFromEntries(
		edgeEntry{kind: EdgeColumns, edge: n.Columns},
		edgeEntry{kind: EdgeConstraints, edge: n.Constraints},
		edgeEntry{kind: EdgeIndexes, edge: n.Indexes},
		edgeEntry{kind: EdgeTriggers, edge: n.Triggers},
	)
}

func (n *ViewNode) SetColumns(edge EdgeList) {
	if n == nil {
		return
	}
	n.Columns = cloneEdgePointer(edge)
}

func (n *ViewNode) SetConstraints(edge EdgeList) {
	if n == nil {
		return
	}
	n.Constraints = cloneEdgePointer(edge)
}

func (n *ViewNode) SetIndexes(edge EdgeList) {
	if n == nil {
		return
	}
	n.Indexes = cloneEdgePointer(edge)
}

func (n *ViewNode) SetTriggers(edge EdgeList) {
	if n == nil {
		return
	}
	n.Triggers = cloneEdgePointer(edge)
}

func (n *ViewNode) RelationName() string {
	if n == nil {
		return ""
	}
	return n.Attributes.Table
}

type ColumnNode struct {
	BaseNode
	Attributes dto.ColumnNodeAttributes
}

func (n *ColumnNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneColumnAttributes(n.Attributes)
	return &clone
}

type ConstraintNode struct {
	BaseNode
	Attributes dto.ConstraintNodeAttributes
}

func (n *ConstraintNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneConstraintAttributes(n.Attributes)
	return &clone
}

type IndexNode struct {
	BaseNode
	Attributes dto.IndexNodeAttributes
}

func (n *IndexNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneIndexAttributes(n.Attributes)
	return &clone
}

type TriggerNode struct {
	BaseNode
	Attributes dto.TriggerNodeAttributes
}

func (n *TriggerNode) Clone(edgeLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneTriggerAttributes(n.Attributes)
	return &clone
}

func cloneScope(scope ScopeID) ScopeID {
	cloned := ScopeID{Database: scope.Database}
	if scope.Schema != nil {
		schema := *scope.Schema
		cloned.Schema = &schema
	}
	return cloned
}

type edgeEntry struct {
	kind string
	edge *EdgeList
}

func edgesFromEntries(entries ...edgeEntry) map[string]EdgeList {
	if len(entries) == 0 {
		return map[string]EdgeList{}
	}
	out := make(map[string]EdgeList, len(entries))
	for _, entry := range entries {
		if entry.edge == nil {
			continue
		}
		out[entry.kind] = cloneEdge(*entry.edge)
	}
	if len(out) == 0 {
		return map[string]EdgeList{}
	}
	return out
}

func cloneEdge(edge EdgeList) EdgeList {
	items := make([]string, len(edge.Items))
	copy(items, edge.Items)
	return EdgeList{Items: items, Truncated: edge.Truncated}
}

func cloneEdgePointer(edge EdgeList) *EdgeList {
	cloned := cloneEdge(edge)
	return &cloned
}

func cloneEdgeWithLimit(edge *EdgeList, edgeLimit int) *EdgeList {
	if edge == nil {
		return nil
	}
	total := len(edge.Items)
	max := total
	if edgeLimit > 0 && edgeLimit < total {
		max = edgeLimit
	}
	items := make([]string, max)
	copy(items, edge.Items[:max])
	cloned := EdgeList{Items: items, Truncated: edge.Truncated || total > max}
	return &cloned
}

func cloneDatabaseAttributes(attrs dto.DatabaseNodeAttributes) dto.DatabaseNodeAttributes {
	return dto.DatabaseNodeAttributes{
		Connection: attrs.Connection,
		Encoding:   cloneString(attrs.Encoding),
		Engine:     attrs.Engine,
		File:       cloneString(attrs.File),
		PageSize:   cloneInt64(attrs.PageSize),
		Sequence:   cloneInt(attrs.Sequence),
	}
}

func cloneTableAttributes(attrs dto.TableNodeAttributes) dto.TableNodeAttributes {
	return dto.TableNodeAttributes{
		Connection: attrs.Connection,
		Definition: cloneString(attrs.Definition),
		Table:      attrs.Table,
		TableType:  attrs.TableType,
	}
}

func cloneViewAttributes(attrs dto.ViewNodeAttributes) dto.ViewNodeAttributes {
	return dto.ViewNodeAttributes{
		Connection: attrs.Connection,
		Definition: cloneString(attrs.Definition),
		Table:      attrs.Table,
		TableType:  attrs.TableType,
	}
}

func cloneColumnAttributes(attrs dto.ColumnNodeAttributes) dto.ColumnNodeAttributes {
	return dto.ColumnNodeAttributes{
		CharMaxLength:      cloneInt64(attrs.CharMaxLength),
		Column:             attrs.Column,
		Connection:         attrs.Connection,
		DataType:           attrs.DataType,
		DefaultValue:       cloneString(attrs.DefaultValue),
		NotNull:            attrs.NotNull,
		NumericPrecision:   cloneInt64(attrs.NumericPrecision),
		NumericScale:       cloneInt64(attrs.NumericScale),
		Ordinal:            attrs.Ordinal,
		PrimaryKeyPosition: cloneInt(attrs.PrimaryKeyPosition),
		Table:              attrs.Table,
	}
}

func cloneConstraintAttributes(attrs dto.ConstraintNodeAttributes) dto.ConstraintNodeAttributes {
	return dto.ConstraintNodeAttributes{
		CheckClause:        cloneString(attrs.CheckClause),
		Columns:            cloneStringSlicePtr(attrs.Columns),
		Connection:         attrs.Connection,
		ConstraintName:     attrs.ConstraintName,
		ConstraintType:     attrs.ConstraintType,
		IndexName:          cloneString(attrs.IndexName),
		Match:              cloneString(attrs.Match),
		OnDelete:           cloneString(attrs.OnDelete),
		OnUpdate:           cloneString(attrs.OnUpdate),
		ReferencedColumns:  cloneStringSlicePtr(attrs.ReferencedColumns),
		ReferencedDatabase: cloneString(attrs.ReferencedDatabase),
		ReferencedSchema:   cloneString(attrs.ReferencedSchema),
		ReferencedTable:    cloneString(attrs.ReferencedTable),
		Table:              attrs.Table,
	}
}

func cloneIndexAttributes(attrs dto.IndexNodeAttributes) dto.IndexNodeAttributes {
	return dto.IndexNodeAttributes{
		Columns:        cloneStringSlicePtr(attrs.Columns),
		Connection:     attrs.Connection,
		Definition:     cloneString(attrs.Definition),
		IncludeColumns: cloneStringSlicePtr(attrs.IncludeColumns),
		IndexName:      attrs.IndexName,
		Method:         cloneString(attrs.Method),
		Predicate:      cloneString(attrs.Predicate),
		Primary:        attrs.Primary,
		Table:          attrs.Table,
		Unique:         attrs.Unique,
	}
}

func cloneTriggerAttributes(attrs dto.TriggerNodeAttributes) dto.TriggerNodeAttributes {
	return dto.TriggerNodeAttributes{
		Condition:    cloneString(attrs.Condition),
		Connection:   attrs.Connection,
		Definition:   cloneString(attrs.Definition),
		EnabledState: cloneString(attrs.EnabledState),
		Events:       cloneStringSlicePtr(attrs.Events),
		Orientation:  attrs.Orientation,
		Statement:    cloneString(attrs.Statement),
		Table:        attrs.Table,
		Timing:       attrs.Timing,
		TriggerName:  attrs.TriggerName,
	}
}

func cloneInt64(src *int64) *int64 {
	if src == nil {
		return nil
	}
	copy := *src
	return &copy
}

func cloneStringSlicePtr(src *[]string) *[]string {
	if src == nil {
		return nil
	}
	copyOf := make([]string, len(*src))
	copy(copyOf, *src)
	return &copyOf
}
