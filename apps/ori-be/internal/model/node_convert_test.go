package model

import (
	"errors"
	"strings"
	"testing"

	dto "github.com/crueladdict/ori/libs/contract/go"
)

func TestConvertNodesToDTOSuccess(t *testing.T) {
	nodes := []Node{&ColumnNode{
		BaseNode: BaseNode{
			ID:   "col-1",
			Name: "id",
		},
		Attributes: dto.ColumnNodeAttributes{
			Connection:         "local-sqlite",
			Table:              "users",
			Column:             "id",
			Ordinal:            1,
			DataType:           "uuid",
			PrimaryKeyPosition: ptrInt(1),
			NotNull:            true,
		},
	}}

	mapped, err := ConvertNodesToDTO(nodes)
	if err != nil {
		t.Fatalf("unexpected conversion error: %v", err)
	}
	if len(mapped) != 1 {
		t.Fatalf("expected one node, got %d", len(mapped))
	}
	columnNode, err := mapped[0].AsColumnNode()
	if err != nil {
		t.Fatalf("expected column node variant, got error: %v", err)
	}
	if columnNode.Type != dto.Column {
		t.Fatalf("expected type %q, got %q", dto.Column, columnNode.Type)
	}
	if columnNode.Attributes.DataType != "uuid" {
		t.Fatalf("expected dataType=uuid")
	}
}

func TestConvertNodesToDTOFailsOnMissingRequiredField(t *testing.T) {
	nodes := []Node{&TableNode{
		BaseNode: BaseNode{
			ID:   "tbl-1",
			Name: "users",
		},
		Attributes: dto.TableNodeAttributes{
			Table:     "users",
			TableType: "table",
		},
	}}

	_, err := ConvertNodesToDTO(nodes)
	if err == nil {
		t.Fatalf("expected conversion error")
	}
	if !strings.Contains(err.Error(), "attributes.connection is required") {
		t.Fatalf("expected required attribute error, got: %v", err)
	}
}

func TestConvertNodesToDTOFailsOnNilNode(t *testing.T) {
	_, err := ConvertNodesToDTO([]Node{nil})
	if err == nil {
		t.Fatalf("expected conversion error")
	}
	if !strings.Contains(err.Error(), "node at index 0 is nil") {
		t.Fatalf("expected nil node error, got: %v", err)
	}
}

func TestConvertNodesToDTOPropagatesNodeError(t *testing.T) {
	expected := errors.New("boom")
	_, err := ConvertNodesToDTO([]Node{&failingNode{err: expected}})
	if err == nil {
		t.Fatalf("expected conversion error")
	}
	if !errors.Is(err, expected) {
		t.Fatalf("expected wrapped error %v, got %v", expected, err)
	}
}

func TestNodesToDTOKeepsEdgeTruncationFlag(t *testing.T) {
	dbNode := &DatabaseNode{
		BaseNode: BaseNode{
			ID:   "db-1",
			Name: "main",
		},
		Attributes: dto.DatabaseNodeAttributes{
			Connection: "local-sqlite",
			Engine:     "sqlite",
		},
	}
	dbNode.SetTables(EdgeList{Items: []string{"users", "orders"}, Truncated: true})
	nodes := Nodes{dbNode}

	mapped, err := nodes.ToDTO()
	if err != nil {
		t.Fatalf("unexpected conversion error: %v", err)
	}
	mappedDBNode, err := mapped[0].AsDatabaseNode()
	if err != nil {
		t.Fatalf("expected database node variant, got error: %v", err)
	}
	edge := mappedDBNode.Edges["tables"]
	if !edge.Truncated {
		t.Fatalf("expected tables edge to be truncated")
	}
	if len(edge.Items) != 2 {
		t.Fatalf("expected 2 edge items, got %d", len(edge.Items))
	}
}

type failingNode struct {
	err error
}

func (n *failingNode) GetID() string {
	return "fail"
}

func (n *failingNode) GetName() string {
	return "fail"
}

func (n *failingNode) GetScope() ScopeID {
	return ScopeID{}
}

func (n *failingNode) GetEdges() map[string]EdgeList {
	return map[string]EdgeList{}
}

func (n *failingNode) IsHydrated() bool {
	return false
}

func (n *failingNode) SetHydrated(bool) {}

func (n *failingNode) Clone(int) Node {
	clone := *n
	return &clone
}

func (n *failingNode) ToDTO() (dto.Node, error) {
	return dto.Node{}, n.err
}

func ptrInt(v int) *int {
	return &v
}
