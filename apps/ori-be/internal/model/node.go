package model

import (
	dto "github.com/crueladdict/ori/libs/contract/go"
)

// Node is the common graph node interface used by services and storage.
type Node interface {
	GetID() string
	GetName() string
	GetScope() ScopeID
	IsHydrated() bool
	SetHydrated(value bool)
	Clone(relationLimit int) Node
	ToDTO() (dto.Node, error)
}

const (
	NodeRelationTables      = "tables"
	NodeRelationViews       = "views"
	NodeRelationPartitions  = "partitions"
	NodeRelationColumns     = "columns"
	NodeRelationConstraints = "constraints"
	NodeRelationIndexes     = "indexes"
	NodeRelationTriggers    = "triggers"
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
	Attributes      dto.DatabaseNodeAttributes
	Tables          []string
	TablesLoaded    bool
	TablesTruncated bool
	Views           []string
	ViewsLoaded     bool
	ViewsTruncated  bool
}

func (n *DatabaseNode) Clone(relationLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneDatabaseAttributes(n.Attributes)
	clone.Tables, clone.TablesLoaded, clone.TablesTruncated = cloneRelationIDsWithLimit(n.Tables, n.TablesLoaded, n.TablesTruncated, relationLimit)
	clone.Views, clone.ViewsLoaded, clone.ViewsTruncated = cloneRelationIDsWithLimit(n.Views, n.ViewsLoaded, n.ViewsTruncated, relationLimit)
	return &clone
}

func (n *DatabaseNode) SetTables(tableIDs []string) {
	if n == nil {
		return
	}
	n.Tables = cloneStringSlice(tableIDs)
	n.TablesLoaded = true
	n.TablesTruncated = false
}

func (n *DatabaseNode) SetViews(viewIDs []string) {
	if n == nil {
		return
	}
	n.Views = cloneStringSlice(viewIDs)
	n.ViewsLoaded = true
	n.ViewsTruncated = false
}

type SchemaNode struct {
	BaseNode
	Attributes      dto.SchemaNodeAttributes
	Tables          []string
	TablesLoaded    bool
	TablesTruncated bool
	Views           []string
	ViewsLoaded     bool
	ViewsTruncated  bool
}

func (n *SchemaNode) Clone(relationLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = n.Attributes
	clone.Tables, clone.TablesLoaded, clone.TablesTruncated = cloneRelationIDsWithLimit(n.Tables, n.TablesLoaded, n.TablesTruncated, relationLimit)
	clone.Views, clone.ViewsLoaded, clone.ViewsTruncated = cloneRelationIDsWithLimit(n.Views, n.ViewsLoaded, n.ViewsTruncated, relationLimit)
	return &clone
}

func (n *SchemaNode) SetTables(tableIDs []string) {
	if n == nil {
		return
	}
	n.Tables = cloneStringSlice(tableIDs)
	n.TablesLoaded = true
	n.TablesTruncated = false
}

func (n *SchemaNode) SetViews(viewIDs []string) {
	if n == nil {
		return
	}
	n.Views = cloneStringSlice(viewIDs)
	n.ViewsLoaded = true
	n.ViewsTruncated = false
}

type TableNode struct {
	BaseNode
	Attributes           dto.TableNodeAttributes
	Partitions           []string
	PartitionsLoaded     bool
	PartitionsTruncated  bool
	Columns              []string
	ColumnsLoaded        bool
	ColumnsTruncated     bool
	Constraints          []string
	ConstraintsLoaded    bool
	ConstraintsTruncated bool
	Indexes              []string
	IndexesLoaded        bool
	IndexesTruncated     bool
	Triggers             []string
	TriggersLoaded       bool
	TriggersTruncated    bool
}

func (n *TableNode) Clone(relationLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneTableAttributes(n.Attributes)
	clone.Partitions, clone.PartitionsLoaded, clone.PartitionsTruncated = cloneRelationIDsWithLimit(n.Partitions, n.PartitionsLoaded, n.PartitionsTruncated, relationLimit)
	clone.Columns, clone.ColumnsLoaded, clone.ColumnsTruncated = cloneRelationIDsWithLimit(n.Columns, n.ColumnsLoaded, n.ColumnsTruncated, relationLimit)
	clone.Constraints, clone.ConstraintsLoaded, clone.ConstraintsTruncated = cloneRelationIDsWithLimit(n.Constraints, n.ConstraintsLoaded, n.ConstraintsTruncated, relationLimit)
	clone.Indexes, clone.IndexesLoaded, clone.IndexesTruncated = cloneRelationIDsWithLimit(n.Indexes, n.IndexesLoaded, n.IndexesTruncated, relationLimit)
	clone.Triggers, clone.TriggersLoaded, clone.TriggersTruncated = cloneRelationIDsWithLimit(n.Triggers, n.TriggersLoaded, n.TriggersTruncated, relationLimit)
	return &clone
}

func (n *TableNode) SetPartitions(partitionIDs []string) {
	if n == nil {
		return
	}
	n.Partitions = cloneStringSlice(partitionIDs)
	n.PartitionsLoaded = true
	n.PartitionsTruncated = false
}

func (n *TableNode) SetColumns(columnIDs []string) {
	if n == nil {
		return
	}
	n.Columns = cloneStringSlice(columnIDs)
	n.ColumnsLoaded = true
	n.ColumnsTruncated = false
}

func (n *TableNode) SetConstraints(constraintIDs []string) {
	if n == nil {
		return
	}
	n.Constraints = cloneStringSlice(constraintIDs)
	n.ConstraintsLoaded = true
	n.ConstraintsTruncated = false
}

func (n *TableNode) SetIndexes(indexIDs []string) {
	if n == nil {
		return
	}
	n.Indexes = cloneStringSlice(indexIDs)
	n.IndexesLoaded = true
	n.IndexesTruncated = false
}

func (n *TableNode) SetTriggers(triggerIDs []string) {
	if n == nil {
		return
	}
	n.Triggers = cloneStringSlice(triggerIDs)
	n.TriggersLoaded = true
	n.TriggersTruncated = false
}

func (n *TableNode) RelationName() string {
	if n == nil {
		return ""
	}
	return n.Attributes.Table
}

type ViewNode struct {
	BaseNode
	Attributes           dto.ViewNodeAttributes
	Columns              []string
	ColumnsLoaded        bool
	ColumnsTruncated     bool
	Constraints          []string
	ConstraintsLoaded    bool
	ConstraintsTruncated bool
	Indexes              []string
	IndexesLoaded        bool
	IndexesTruncated     bool
	Triggers             []string
	TriggersLoaded       bool
	TriggersTruncated    bool
}

func (n *ViewNode) Clone(relationLimit int) Node {
	if n == nil {
		return nil
	}
	clone := *n
	clone.BaseNode = n.cloneBase()
	clone.Attributes = cloneViewAttributes(n.Attributes)
	clone.Columns, clone.ColumnsLoaded, clone.ColumnsTruncated = cloneRelationIDsWithLimit(n.Columns, n.ColumnsLoaded, n.ColumnsTruncated, relationLimit)
	clone.Constraints, clone.ConstraintsLoaded, clone.ConstraintsTruncated = cloneRelationIDsWithLimit(n.Constraints, n.ConstraintsLoaded, n.ConstraintsTruncated, relationLimit)
	clone.Indexes, clone.IndexesLoaded, clone.IndexesTruncated = cloneRelationIDsWithLimit(n.Indexes, n.IndexesLoaded, n.IndexesTruncated, relationLimit)
	clone.Triggers, clone.TriggersLoaded, clone.TriggersTruncated = cloneRelationIDsWithLimit(n.Triggers, n.TriggersLoaded, n.TriggersTruncated, relationLimit)
	return &clone
}

func (n *ViewNode) SetColumns(columnIDs []string) {
	if n == nil {
		return
	}
	n.Columns = cloneStringSlice(columnIDs)
	n.ColumnsLoaded = true
	n.ColumnsTruncated = false
}

func (n *ViewNode) SetConstraints(constraintIDs []string) {
	if n == nil {
		return
	}
	n.Constraints = cloneStringSlice(constraintIDs)
	n.ConstraintsLoaded = true
	n.ConstraintsTruncated = false
}

func (n *ViewNode) SetIndexes(indexIDs []string) {
	if n == nil {
		return
	}
	n.Indexes = cloneStringSlice(indexIDs)
	n.IndexesLoaded = true
	n.IndexesTruncated = false
}

func (n *ViewNode) SetTriggers(triggerIDs []string) {
	if n == nil {
		return
	}
	n.Triggers = cloneStringSlice(triggerIDs)
	n.TriggersLoaded = true
	n.TriggersTruncated = false
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

func (n *ColumnNode) Clone(relationLimit int) Node {
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

func (n *ConstraintNode) Clone(relationLimit int) Node {
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

func (n *IndexNode) Clone(relationLimit int) Node {
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

func (n *TriggerNode) Clone(relationLimit int) Node {
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

func cloneStringSlice(src []string) []string {
	copyOf := make([]string, len(src))
	copy(copyOf, src)
	return copyOf
}

func cloneRelationIDsWithLimit(ids []string, loaded bool, truncated bool, relationLimit int) ([]string, bool, bool) {
	if !loaded {
		return nil, false, false
	}
	total := len(ids)
	max := total
	if relationLimit > 0 && relationLimit < total {
		max = relationLimit
	}
	cloned := make([]string, max)
	copy(cloned, ids[:max])
	return cloned, true, truncated || total > max
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
