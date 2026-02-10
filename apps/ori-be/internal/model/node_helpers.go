package model

import dto "github.com/crueladdict/ori/libs/contract/go"

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

func cloneRelationIDs(ids []string, loaded bool, truncated bool) ([]string, bool, bool) {
	if !loaded {
		return nil, false, false
	}
	cloned := make([]string, len(ids))
	copy(cloned, ids)
	return cloned, true, truncated
}

func emptyRelationsToDTO() map[string]dto.NodeEdge {
	return map[string]dto.NodeEdge{}
}

func relationToDTO(ids []string, truncated bool) dto.NodeEdge {
	items := make([]string, len(ids))
	copy(items, ids)
	return dto.NodeEdge{Items: items, Truncated: truncated}
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
