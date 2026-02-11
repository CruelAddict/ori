package service

import (
	"testing"

	"github.com/crueladdict/ori/apps/ori-server/internal/model"
)

func TestGraphBuilderNodesConvertToDTO(t *testing.T) {
	handle := &ConnectionHandle{
		Name: "local-sqlite",
		Configuration: &model.Configuration{
			Name: "local-sqlite",
			Type: "sqlite",
		},
	}
	b := NewGraphBuilder(handle)

	scope := model.Database{
		Name:     "main",
		File:     stringPtr("/tmp/main.db"),
		Sequence: intPtr(0),
		PageSize: int64Ptr(4096),
		Encoding: stringPtr("UTF-8"),
	}

	relation := model.Relation{Name: "users", Type: "table", Definition: "create table users (...)"}
	defaultValue := "gen_random_uuid()"
	charMaxLength := int64(255)
	numericPrecision := int64(10)
	numericScale := int64(2)
	constraintIndex := "users_email_idx"

	constraint := model.Constraint{
		Name:              "users_email_key",
		Type:              "FOREIGN KEY",
		Columns:           []string{"email"},
		ReferencedScope:   &model.ScopeID{Database: "main"},
		ReferencedTable:   "accounts",
		ReferencedColumns: []string{"email"},
		OnUpdate:          "CASCADE",
		OnDelete:          "RESTRICT",
		Match:             "FULL",
		CheckClause:       "email <> ''",
		UnderlyingIndex:   &constraintIndex,
	}

	index := model.Index{
		Name:           "users_idx",
		Unique:         true,
		Primary:        false,
		Columns:        []string{"email"},
		IncludeColumns: []string{"created_at"},
		Definition:     "create index users_idx ...",
		Method:         "btree",
		Predicate:      "deleted_at is null",
	}

	trigger := model.Trigger{
		Name:         "users_audit",
		Timing:       "BEFORE",
		Events:       []string{"INSERT", "UPDATE"},
		Orientation:  "ROW",
		Statement:    "EXECUTE FUNCTION audit_users()",
		Condition:    "NEW.email IS NOT NULL",
		EnabledState: "enabled",
		Definition:   "create trigger users_audit ...",
	}

	scopeID := scope.ID()
	nodes := []model.Node{b.BuildScopeNode(scope), b.BuildRelationNode(scopeID, relation)}
	columnNodes, _ := b.BuildColumnNodes(scopeID, relation.Name, []model.Column{{
		Name:             "id",
		Ordinal:          1,
		DataType:         "uuid",
		NotNull:          true,
		DefaultValue:     &defaultValue,
		PrimaryKeyPos:    1,
		CharMaxLength:    &charMaxLength,
		NumericPrecision: &numericPrecision,
		NumericScale:     &numericScale,
	}})
	constraintNodes, _ := b.BuildConstraintNodes(scopeID, relation.Name, []model.Constraint{constraint})
	indexNodes, _ := b.BuildIndexNodes(scopeID, relation.Name, []model.Index{index})
	triggerNodes, _ := b.BuildTriggerNodes(scopeID, relation.Name, []model.Trigger{trigger})

	nodes = append(nodes, columnNodes...)
	nodes = append(nodes, constraintNodes...)
	nodes = append(nodes, indexNodes...)
	nodes = append(nodes, triggerNodes...)

	if _, err := model.ConvertNodesToDTO(nodes); err != nil {
		t.Fatalf("expected GraphBuilder output to match contract, got error: %v", err)
	}
}

func stringPtr(v string) *string {
	return &v
}

func intPtr(v int) *int {
	return &v
}

func int64Ptr(v int64) *int64 {
	return &v
}
