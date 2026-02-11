package service

import (
	"sort"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
	dto "github.com/crueladdict/ori/libs/contract/go"
)

// GraphBuilder converts relational metadata into graph nodes.
type GraphBuilder struct {
	engine         string
	connectionName string
}

// NewGraphBuilder creates a graph builder for a connection.
func NewGraphBuilder(handle *ConnectionHandle) *GraphBuilder {
	return &GraphBuilder{
		engine:         handle.Configuration.Type,
		connectionName: handle.Name,
	}
}

// ScopeNodeID generates a unique ID for a scope node.
func (b *GraphBuilder) ScopeNodeID(scope model.ScopeID) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "database", scope.Database)
	}
	return stringutil.Slug(b.engine, b.connectionName, "schema", *scope.Schema)
}

// RelationNodeID generates a unique ID for a table/view node.
func (b *GraphBuilder) RelationNodeID(scope model.ScopeID, rel model.Relation) string {
	nodeType := rel.Type
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, nodeType, scope.Database, rel.Name)
	}
	return stringutil.Slug(b.engine, b.connectionName, nodeType, *scope.Schema, rel.Name)
}

// ColumnNodeID generates a unique ID for a column node.
func (b *GraphBuilder) ColumnNodeID(scope model.ScopeID, relation, column string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "column", scope.Database, relation, column)
	}
	return stringutil.Slug(b.engine, b.connectionName, "column", *scope.Schema, relation, column)
}

// ConstraintNodeID generates a unique ID for a constraint node.
func (b *GraphBuilder) ConstraintNodeID(scope model.ScopeID, relation, constraintName string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "constraint", scope.Database, relation, constraintName)
	}
	return stringutil.Slug(b.engine, b.connectionName, "constraint", *scope.Schema, relation, constraintName)
}

// IndexNodeID generates a unique ID for an index node.
func (b *GraphBuilder) IndexNodeID(scope model.ScopeID, relation, indexName string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "index", scope.Database, relation, indexName)
	}
	return stringutil.Slug(b.engine, b.connectionName, "index", *scope.Schema, relation, indexName)
}

// TriggerNodeID generates a unique ID for a trigger node.
func (b *GraphBuilder) TriggerNodeID(scope model.ScopeID, relation, triggerName string) string {
	if scope.Schema == nil {
		return stringutil.Slug(b.engine, b.connectionName, "trigger", scope.Database, relation, triggerName)
	}
	return stringutil.Slug(b.engine, b.connectionName, "trigger", *scope.Schema, relation, triggerName)
}

// BuildScopeNode creates a node for a scope.
func (b *GraphBuilder) BuildScopeNode(scope model.Scope) model.Node {
	if scope.Schema == nil {
		attrs := dto.DatabaseNodeAttributes{
			Connection: b.connectionName,
			Engine:     b.engine,
		}
		if file, ok := attributeAsString(scope.Attrs, "file"); ok {
			attrs.File = &file
		}
		if sequence, ok := attributeAsInt(scope.Attrs, "sequence"); ok {
			attrs.Sequence = &sequence
		}
		if pageSize, ok := attributeAsInt64(scope.Attrs, "pageSize"); ok {
			attrs.PageSize = &pageSize
		}
		if encoding, ok := attributeAsString(scope.Attrs, "encoding"); ok {
			attrs.Encoding = &encoding
		}
		return &model.DatabaseNode{
			BaseNode: model.BaseNode{
				ID:       b.ScopeNodeID(scope.ScopeID),
				Name:     scope.Database,
				Scope:    scope.ScopeID,
				Hydrated: false,
			},
			Attributes: attrs,
		}
	}

	return &model.SchemaNode{
		BaseNode: model.BaseNode{
			ID:       b.ScopeNodeID(scope.ScopeID),
			Name:     *scope.Schema,
			Scope:    scope.ScopeID,
			Hydrated: false,
		},
		Attributes: dto.SchemaNodeAttributes{
			Connection: b.connectionName,
			Engine:     b.engine,
		},
	}
}

// BuildRelationNode creates a node for a table or view.
func (b *GraphBuilder) BuildRelationNode(scope model.ScopeID, rel model.Relation) model.Node {
	if rel.Type == "view" {
		attrs := dto.ViewNodeAttributes{
			Connection: b.connectionName,
			Table:      rel.Name,
			TableType:  rel.Type,
		}
		if rel.Definition != "" {
			attrs.Definition = &rel.Definition
		}
		return &model.ViewNode{
			BaseNode: model.BaseNode{
				ID:       b.RelationNodeID(scope, rel),
				Name:     rel.Name,
				Scope:    scope,
				Hydrated: false,
			},
			Attributes: attrs,
		}
	}

	attrs := dto.TableNodeAttributes{
		Connection: b.connectionName,
		Table:      rel.Name,
		TableType:  rel.Type,
	}
	if rel.Definition != "" {
		attrs.Definition = &rel.Definition
	}
	return &model.TableNode{
		BaseNode: model.BaseNode{
			ID:       b.RelationNodeID(scope, rel),
			Name:     rel.Name,
			Scope:    scope,
			Hydrated: false,
		},
		Attributes: attrs,
	}
}

// BuildColumnNodes creates nodes for table columns.
func (b *GraphBuilder) BuildColumnNodes(scope model.ScopeID, relation string, columns []model.Column) ([]model.Node, []string) {
	nodes := make([]model.Node, 0, len(columns))
	columnIDs := make([]string, 0, len(columns))

	for _, col := range columns {
		attrs := dto.ColumnNodeAttributes{
			Connection: b.connectionName,
			Table:      relation,
			Column:     col.Name,
			Ordinal:    col.Ordinal,
			DataType:   col.DataType,
			NotNull:    col.NotNull,
		}

		if col.DefaultValue != nil {
			attrs.DefaultValue = cloneutil.Ptr(col.DefaultValue)
		}
		if col.PrimaryKeyPos > 0 {
			v := col.PrimaryKeyPos
			attrs.PrimaryKeyPosition = &v
		}
		if col.CharMaxLength != nil {
			attrs.CharMaxLength = cloneutil.Ptr(col.CharMaxLength)
		}
		if col.NumericPrecision != nil {
			attrs.NumericPrecision = cloneutil.Ptr(col.NumericPrecision)
		}
		if col.NumericScale != nil {
			attrs.NumericScale = cloneutil.Ptr(col.NumericScale)
		}

		node := &model.ColumnNode{
			BaseNode: model.BaseNode{
				ID:       b.ColumnNodeID(scope, relation, col.Name),
				Name:     col.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Attributes: attrs,
		}
		nodes = append(nodes, node)
		columnIDs = append(columnIDs, node.GetID())
	}

	return nodes, columnIDs
}

// BuildConstraintNodes creates nodes for table constraints.
func (b *GraphBuilder) BuildConstraintNodes(scope model.ScopeID, relation string, constraints []model.Constraint) ([]model.Node, []string) {
	sort.Slice(constraints, func(i, j int) bool {
		if constraints[i].Type != constraints[j].Type {
			return constraintTypeOrder(constraints[i].Type) < constraintTypeOrder(constraints[j].Type)
		}
		return constraints[i].Name < constraints[j].Name
	})

	nodes := make([]model.Node, 0, len(constraints))
	constraintIDs := make([]string, 0, len(constraints))

	for _, c := range constraints {
		attrs := dto.ConstraintNodeAttributes{
			Connection:     b.connectionName,
			Table:          relation,
			ConstraintName: c.Name,
			ConstraintType: c.Type,
		}

		if len(c.Columns) > 0 {
			attrs.Columns = cloneutil.SlicePtrIfNotEmpty(c.Columns)
		}

		if c.Type == "FOREIGN KEY" {
			attrs.ReferencedTable = stringPtrIfNotEmpty(c.ReferencedTable)
			if c.ReferencedScope != nil {
				attrs.ReferencedDatabase = stringPtrIfNotEmpty(c.ReferencedScope.Database)
				if c.ReferencedScope.Schema != nil {
					attrs.ReferencedSchema = cloneutil.Ptr(c.ReferencedScope.Schema)
				}
			}
			if len(c.ReferencedColumns) > 0 {
				attrs.ReferencedColumns = cloneutil.SlicePtrIfNotEmpty(c.ReferencedColumns)
			}
			attrs.OnUpdate = stringPtrIfNotEmpty(c.OnUpdate)
			attrs.OnDelete = stringPtrIfNotEmpty(c.OnDelete)
			attrs.Match = stringPtrIfNotEmpty(c.Match)
		}

		if c.UnderlyingIndex != nil {
			attrs.IndexName = cloneutil.Ptr(c.UnderlyingIndex)
		}

		if c.CheckClause != "" {
			attrs.CheckClause = stringPtrIfNotEmpty(c.CheckClause)
		}

		node := &model.ConstraintNode{
			BaseNode: model.BaseNode{
				ID:       b.ConstraintNodeID(scope, relation, c.Name),
				Name:     c.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Attributes: attrs,
		}
		nodes = append(nodes, node)
		constraintIDs = append(constraintIDs, node.GetID())
	}

	return nodes, constraintIDs
}

// BuildIndexNodes creates nodes for table/view indexes.
func (b *GraphBuilder) BuildIndexNodes(scope model.ScopeID, relation string, indexes []model.Index) ([]model.Node, []string) {
	sort.Slice(indexes, func(i, j int) bool {
		return indexes[i].Name < indexes[j].Name
	})

	nodes := make([]model.Node, 0, len(indexes))
	indexIDs := make([]string, 0, len(indexes))

	for _, idx := range indexes {
		attrs := dto.IndexNodeAttributes{
			Connection: b.connectionName,
			Table:      relation,
			IndexName:  idx.Name,
			Unique:     idx.Unique,
			Primary:    idx.Primary,
		}

		if len(idx.Columns) > 0 {
			attrs.Columns = cloneutil.SlicePtrIfNotEmpty(idx.Columns)
		}
		if len(idx.IncludeColumns) > 0 {
			attrs.IncludeColumns = cloneutil.SlicePtrIfNotEmpty(idx.IncludeColumns)
		}
		if idx.Definition != "" {
			attrs.Definition = stringPtrIfNotEmpty(idx.Definition)
		}
		if idx.Method != "" {
			attrs.Method = stringPtrIfNotEmpty(idx.Method)
		}
		if idx.Predicate != "" {
			attrs.Predicate = stringPtrIfNotEmpty(idx.Predicate)
		}

		node := &model.IndexNode{
			BaseNode: model.BaseNode{
				ID:       b.IndexNodeID(scope, relation, idx.Name),
				Name:     idx.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Attributes: attrs,
		}
		nodes = append(nodes, node)
		indexIDs = append(indexIDs, node.GetID())
	}

	return nodes, indexIDs
}

// BuildTriggerNodes creates nodes for table/view triggers.
func (b *GraphBuilder) BuildTriggerNodes(scope model.ScopeID, relation string, triggers []model.Trigger) ([]model.Node, []string) {
	sort.Slice(triggers, func(i, j int) bool {
		return triggers[i].Name < triggers[j].Name
	})

	nodes := make([]model.Node, 0, len(triggers))
	triggerIDs := make([]string, 0, len(triggers))

	for _, trg := range triggers {
		attrs := dto.TriggerNodeAttributes{
			Connection:  b.connectionName,
			Table:       relation,
			TriggerName: trg.Name,
			Timing:      trg.Timing,
			Orientation: trg.Orientation,
		}

		if len(trg.Events) > 0 {
			attrs.Events = cloneutil.SlicePtrIfNotEmpty(trg.Events)
		}
		if trg.Statement != "" {
			attrs.Statement = stringPtrIfNotEmpty(trg.Statement)
		}
		if trg.Condition != "" {
			attrs.Condition = stringPtrIfNotEmpty(trg.Condition)
		}
		if trg.EnabledState != "" {
			attrs.EnabledState = stringPtrIfNotEmpty(trg.EnabledState)
		}
		if trg.Definition != "" {
			attrs.Definition = stringPtrIfNotEmpty(trg.Definition)
		}

		node := &model.TriggerNode{
			BaseNode: model.BaseNode{
				ID:       b.TriggerNodeID(scope, relation, trg.Name),
				Name:     trg.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Attributes: attrs,
		}
		nodes = append(nodes, node)
		triggerIDs = append(triggerIDs, node.GetID())
	}

	return nodes, triggerIDs
}

func constraintTypeOrder(t string) int {
	switch t {
	case "PRIMARY KEY":
		return 0
	case "UNIQUE":
		return 1
	case "FOREIGN KEY":
		return 2
	case "CHECK":
		return 3
	default:
		return 4
	}
}

func attributeAsString(attrs map[string]any, key string) (string, bool) {
	v, ok := attrs[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	if !ok {
		return "", false
	}
	return s, true
}

func attributeAsInt(attrs map[string]any, key string) (int, bool) {
	v, ok := attrs[key]
	if !ok {
		return 0, false
	}
	i, ok := v.(int)
	if ok {
		return i, true
	}
	i64, ok := v.(int64)
	if ok {
		return int(i64), true
	}
	return 0, false
}

func attributeAsInt64(attrs map[string]any, key string) (int64, bool) {
	v, ok := attrs[key]
	if !ok {
		return 0, false
	}
	i64, ok := v.(int64)
	if ok {
		return i64, true
	}
	i, ok := v.(int)
	if ok {
		return int64(i), true
	}
	return 0, false
}

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	v := value
	return &v
}
