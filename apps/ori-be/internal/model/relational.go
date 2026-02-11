package model

import "github.com/crueladdict/ori/apps/ori-server/internal/pkg/stringutil"

// Scope identifies a namespace for relations and can create its root graph node.
type Scope interface {
	Slug() string
	Connection() string
	DatabaseName() string
	SchemaName() *string
	WithSchema(name *string) Scope
	Clone() Scope
	NewRootNode() Node
}

// Database is a root scope for engines without schemas (for example sqlite).
type Database struct {
	Engine         string
	ConnectionName string
	Name           string
	File           *string
	Sequence       *int
	PageSize       *int64
	Encoding       *string
}

func (s Database) Slug() string {
	return stringutil.Slug(s.Engine, s.ConnectionName, s.Name)
}

func (s Database) Connection() string {
	return s.ConnectionName
}

func (s Database) DatabaseName() string {
	return s.Name
}

func (s Database) SchemaName() *string {
	return nil
}

func (s Database) WithSchema(name *string) Scope {
	if name == nil || *name == "" {
		return s
	}
	return Schema{
		Engine:         s.Engine,
		ConnectionName: s.ConnectionName,
		Database:       s.Name,
		Name:           *name,
	}
}

func (s Database) Clone() Scope {
	return s
}

func (s Database) NewRootNode() Node {
	return NewDatabaseNode(s)
}

// Schema is a root scope for engines with schemas (for example postgres).
type Schema struct {
	Engine         string
	ConnectionName string
	Database       string
	Name           string
}

func (s Schema) Slug() string {
	return stringutil.Slug(s.Engine, s.ConnectionName, s.Name)
}

func (s Schema) Connection() string {
	return s.ConnectionName
}

func (s Schema) DatabaseName() string {
	return s.Database
}

func (s Schema) SchemaName() *string {
	schema := s.Name
	return &schema
}

func (s Schema) WithSchema(name *string) Scope {
	if name == nil || *name == "" {
		return s
	}
	return Schema{
		Engine:         s.Engine,
		ConnectionName: s.ConnectionName,
		Database:       s.Database,
		Name:           *name,
	}
}

func (s Schema) Clone() Scope {
	return s
}

func (s Schema) NewRootNode() Node {
	return NewSchemaNode(s)
}

// Relation describes a table or view.
type Relation struct {
	Name         string
	Type         string  // "table" or "view"
	Definition   string  // View definition SQL, if applicable
	Schema       *string // Relation schema (Postgres), if applicable
	ParentSchema *string // Partition parent schema (Postgres), if applicable
	ParentTable  *string // Partition parent table name (Postgres), if applicable
}

// Column describes a table/view column.
type Column struct {
	Name             string
	Ordinal          int
	DataType         string
	NotNull          bool
	DefaultValue     *string
	PrimaryKeyPos    int // 0 = not part of PK, >0 = position in composite PK
	CharMaxLength    *int64
	NumericPrecision *int64
	NumericScale     *int64
}

// Constraint describes a table constraint.
type Constraint struct {
	Name              string
	Type              string // "PRIMARY KEY", "UNIQUE", "FOREIGN KEY", "CHECK"
	Columns           []string
	ReferencedScope   Scope    // FK: target scope
	ReferencedTable   string   // FK: target table
	ReferencedColumns []string // FK: target columns (parallel to Columns)
	OnUpdate          string   // FK: update rule
	OnDelete          string   // FK: delete rule
	Match             string   // FK: match type
	CheckClause       string   // CHECK: the check expression
	UnderlyingIndex   *string  // UNIQUE: underlying index name
}

// Index describes a table/view index.
type Index struct {
	Name           string
	Unique         bool
	Primary        bool
	Columns        []string
	IncludeColumns []string
	Definition     string
	Method         string
	Predicate      string
}

// Trigger describes a table/view trigger.
type Trigger struct {
	Name         string
	Timing       string
	Events       []string
	Orientation  string
	Statement    string
	Condition    string
	EnabledState string
	Definition   string
}
