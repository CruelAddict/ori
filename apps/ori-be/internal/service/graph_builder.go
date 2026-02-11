package service

import (
	"sort"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/cloneutil"
	"github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"
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
		file := cloneutil.Ptr(scope.File)
		sequence := cloneutil.Ptr(scope.Sequence)
		pageSize := cloneutil.Ptr(scope.PageSize)
		encoding := cloneutil.Ptr(scope.Encoding)
		return &model.DatabaseNode{
			BaseNode: model.BaseNode{
				ID:       b.ScopeNodeID(scope.ScopeID),
				Name:     scope.Database,
				Scope:    scope.ScopeID,
				Hydrated: false,
			},
			Connection: b.connectionName,
			Engine:     b.engine,
			File:       file,
			Sequence:   sequence,
			PageSize:   pageSize,
			Encoding:   encoding,
		}
	}

	return &model.SchemaNode{
		BaseNode: model.BaseNode{
			ID:       b.ScopeNodeID(scope.ScopeID),
			Name:     *scope.Schema,
			Scope:    scope.ScopeID,
			Hydrated: false,
		},
		Connection: b.connectionName,
		Engine:     b.engine,
	}
}

// BuildRelationNode creates a node for a table or view.
func (b *GraphBuilder) BuildRelationNode(scope model.ScopeID, rel model.Relation) model.Node {
	if rel.Type == "view" {
		definition := stringPtrIfNotEmpty(rel.Definition)
		return &model.ViewNode{
			BaseNode: model.BaseNode{
				ID:       b.RelationNodeID(scope, rel),
				Name:     rel.Name,
				Scope:    scope,
				Hydrated: false,
			},
			Connection: b.connectionName,
			Definition: definition,
			Table:      rel.Name,
			TableType:  rel.Type,
		}
	}

	definition := stringPtrIfNotEmpty(rel.Definition)
	return &model.TableNode{
		BaseNode: model.BaseNode{
			ID:       b.RelationNodeID(scope, rel),
			Name:     rel.Name,
			Scope:    scope,
			Hydrated: false,
		},
		Connection: b.connectionName,
		Definition: definition,
		Table:      rel.Name,
		TableType:  rel.Type,
	}
}

// BuildColumnNodes creates nodes for table columns.
func (b *GraphBuilder) BuildColumnNodes(scope model.ScopeID, relation string, columns []model.Column) ([]model.Node, []string) {
	nodes := make([]model.Node, 0, len(columns))
	columnIDs := make([]string, 0, len(columns))

	for _, col := range columns {
		defaultValue := cloneutil.Ptr(col.DefaultValue)
		var primaryKeyPosition *int
		if col.PrimaryKeyPos > 0 {
			v := col.PrimaryKeyPos
			primaryKeyPosition = &v
		}
		charMaxLength := cloneutil.Ptr(col.CharMaxLength)
		numericPrecision := cloneutil.Ptr(col.NumericPrecision)
		numericScale := cloneutil.Ptr(col.NumericScale)

		node := &model.ColumnNode{
			BaseNode: model.BaseNode{
				ID:       b.ColumnNodeID(scope, relation, col.Name),
				Name:     col.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Connection:         b.connectionName,
			Table:              relation,
			Column:             col.Name,
			Ordinal:            col.Ordinal,
			DataType:           col.DataType,
			NotNull:            col.NotNull,
			DefaultValue:       defaultValue,
			PrimaryKeyPosition: primaryKeyPosition,
			CharMaxLength:      charMaxLength,
			NumericPrecision:   numericPrecision,
			NumericScale:       numericScale,
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
		columns := cloneutil.SlicePtrIfNotEmpty(c.Columns)
		referencedTable := stringPtrIfNotEmpty(c.ReferencedTable)
		var referencedDatabase *string
		var referencedSchema *string
		var referencedColumns *[]string
		onUpdate := stringPtrIfNotEmpty(c.OnUpdate)
		onDelete := stringPtrIfNotEmpty(c.OnDelete)
		match := stringPtrIfNotEmpty(c.Match)

		if c.Type == "FOREIGN KEY" {
			if c.ReferencedScope != nil {
				referencedDatabase = stringPtrIfNotEmpty(c.ReferencedScope.Database)
				if c.ReferencedScope.Schema != nil {
					referencedSchema = cloneutil.Ptr(c.ReferencedScope.Schema)
				}
			}
			referencedColumns = cloneutil.SlicePtrIfNotEmpty(c.ReferencedColumns)
		}

		indexName := cloneutil.Ptr(c.UnderlyingIndex)
		checkClause := stringPtrIfNotEmpty(c.CheckClause)

		node := &model.ConstraintNode{
			BaseNode: model.BaseNode{
				ID:       b.ConstraintNodeID(scope, relation, c.Name),
				Name:     c.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Connection:         b.connectionName,
			Table:              relation,
			ConstraintName:     c.Name,
			ConstraintType:     c.Type,
			Columns:            columns,
			ReferencedTable:    referencedTable,
			ReferencedDatabase: referencedDatabase,
			ReferencedSchema:   referencedSchema,
			ReferencedColumns:  referencedColumns,
			OnUpdate:           onUpdate,
			OnDelete:           onDelete,
			Match:              match,
			IndexName:          indexName,
			CheckClause:        checkClause,
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
		columns := cloneutil.SlicePtrIfNotEmpty(idx.Columns)
		includeColumns := cloneutil.SlicePtrIfNotEmpty(idx.IncludeColumns)
		definition := stringPtrIfNotEmpty(idx.Definition)
		method := stringPtrIfNotEmpty(idx.Method)
		predicate := stringPtrIfNotEmpty(idx.Predicate)

		node := &model.IndexNode{
			BaseNode: model.BaseNode{
				ID:       b.IndexNodeID(scope, relation, idx.Name),
				Name:     idx.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Connection:     b.connectionName,
			Table:          relation,
			IndexName:      idx.Name,
			Unique:         idx.Unique,
			Primary:        idx.Primary,
			Columns:        columns,
			IncludeColumns: includeColumns,
			Definition:     definition,
			Method:         method,
			Predicate:      predicate,
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
		events := cloneutil.SlicePtrIfNotEmpty(trg.Events)
		statement := stringPtrIfNotEmpty(trg.Statement)
		condition := stringPtrIfNotEmpty(trg.Condition)
		enabledState := stringPtrIfNotEmpty(trg.EnabledState)
		definition := stringPtrIfNotEmpty(trg.Definition)

		node := &model.TriggerNode{
			BaseNode: model.BaseNode{
				ID:       b.TriggerNodeID(scope, relation, trg.Name),
				Name:     trg.Name,
				Scope:    scope,
				Hydrated: true,
			},
			Connection:   b.connectionName,
			Table:        relation,
			TriggerName:  trg.Name,
			Timing:       trg.Timing,
			Orientation:  trg.Orientation,
			Events:       events,
			Statement:    statement,
			Condition:    condition,
			EnabledState: enabledState,
			Definition:   definition,
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

func stringPtrIfNotEmpty(value string) *string {
	if value == "" {
		return nil
	}
	v := value
	return &v
}
