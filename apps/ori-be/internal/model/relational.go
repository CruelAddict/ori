package model

// ScopeID identifies a namespace for relations (database + optional schema).
type ScopeID struct {
	Database string
	Schema   *string // nil if engine doesn't support schemas
}

// Scope is a ScopeID with additional engine-specific attributes.
type Scope struct {
	ScopeID
	Attrs map[string]any
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
	ReferencedScope   *ScopeID // FK: target scope
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
