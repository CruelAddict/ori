import { type Node, NodeType } from "@adapters/ori/client"
import { createSqlAutocompleteProvider } from "@ui/widgets/editor-panel/sql-autocomplete/provider"
import type { SqlSchemaInput } from "@ui/widgets/editor-panel/sql-autocomplete/sql-schema-index"

type TableSpec = {
  name: string
  columns: string[]
}

type BenchCase = {
  name: string
  sql: string
}

type BenchResult = {
  name: string
  items: number
  coldMedian: number
  coldP95: number
  warmMedian: number
  warmP95: number
}

type WarehouseState = {
  state: SqlSchemaInput
  schemas: number
  tables: number
  columns: number
}

const SCHEMA_COUNT = 36
const TABLES_PER_SCHEMA = 128
const COLUMNS_PER_TABLE = 28
const COLD_RUNS = 4
const WARM_UP_RUNS = 6
const WARM_RUNS = 40

function withCursor(sql: string) {
  const cursor = sql.indexOf("|")
  if (cursor === -1) {
    throw new Error(`Missing cursor marker in ${sql}`)
  }

  return {
    text: sql.slice(0, cursor) + sql.slice(cursor + 1),
    cursor,
  }
}

function percentile(samples: readonly number[], ratio: number) {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function formatMs(value: number) {
  return `${value.toFixed(value >= 100 ? 1 : value >= 10 ? 2 : 3)} ms`
}

function pad(value: string, width: number) {
  return value.length >= width ? value : value + " ".repeat(width - value.length)
}

function baseColumns() {
  return [
    "id",
    "created_at",
    "updated_at",
    "status",
    "name",
    "type",
    "source_id",
    "owner_id",
    "region_id",
    "batch_id",
    "metric_value",
    "metric_count",
  ]
}

function fillerColumns(seed: string) {
  const values = [...baseColumns()]

  for (const i of Array.from({ length: COLUMNS_PER_TABLE - values.length }, (_, i) => i)) {
    values.push(`${seed}_col_${String(i + 1).padStart(2, "0")}`)
  }

  return values
}

function specialTables() {
  return new Map<string, TableSpec[]>([
    [
      "analytics",
      [
        {
          name: "fact_orders",
          columns: [
            "order_id",
            "user_id",
            "region_id",
            "subscription_id",
            "status",
            "created_at",
            "updated_at",
            "gross_amount",
            "net_amount",
            "tax_amount",
            "warehouse_partition",
            "batch_id",
            "source_system",
            "sales_channel",
            "payment_method",
            "device_type",
            "currency_code",
            "country_code",
            "merchant_id",
            "campaign_id",
            "order_type",
            "risk_score",
            "fraud_flag",
            "retry_count",
            "booked_at",
            "settled_at",
            "cancelled_at",
            "ingested_at",
          ],
        },
        {
          name: "fact_payments",
          columns: [
            "payment_id",
            "order_id",
            "user_id",
            "status",
            "created_at",
            "updated_at",
            "amount",
            "fee_amount",
            "tax_amount",
            "payment_provider",
            "payment_method",
            "attempt_number",
            "captured_at",
            "failed_at",
            "reversed_at",
            "currency_code",
            "country_code",
            "merchant_id",
            "gateway_transaction_id",
            "risk_score",
            "risk_flag",
            "batch_id",
            "warehouse_partition",
            "processor_latency_ms",
            "source_system",
            "session_id",
            "device_type",
            "ingested_at",
          ],
        },
        {
          name: "fact_shipments",
          columns: [
            "shipment_id",
            "order_id",
            "user_id",
            "region_id",
            "status",
            "created_at",
            "updated_at",
            "carrier_name",
            "tracking_number",
            "warehouse_id",
            "warehouse_partition",
            "batch_id",
            "delivery_method",
            "service_level",
            "shipped_at",
            "delivered_at",
            "returned_at",
            "country_code",
            "postal_code",
            "city_name",
            "sla_hours",
            "retry_count",
            "distance_km",
            "package_weight_grams",
            "source_system",
            "device_type",
            "carrier_status",
            "ingested_at",
          ],
        },
        {
          name: "fact_refunds",
          columns: [
            "refund_id",
            "order_id",
            "payment_id",
            "user_id",
            "status",
            "created_at",
            "updated_at",
            "refund_amount",
            "refund_reason",
            "resolved_at",
            "currency_code",
            "country_code",
            "merchant_id",
            "risk_score",
            "risk_flag",
            "batch_id",
            "warehouse_partition",
            "source_system",
            "retry_count",
            "escalation_level",
            "resolution_channel",
            "agent_id",
            "device_type",
            "session_id",
            "case_id",
            "chargeback_flag",
            "booked_at",
            "ingested_at",
          ],
        },
        {
          name: "dim_users",
          columns: [
            "user_id",
            "email",
            "created_at",
            "updated_at",
            "region_id",
            "status",
            "plan_id",
            "subscription_id",
            "country_code",
            "city_name",
            "device_type",
            "signup_channel",
            "preferred_language",
            "timezone_name",
            "birth_year",
            "is_employee",
            "risk_score",
            "marketing_source",
            "marketing_medium",
            "lifetime_value",
            "last_seen_at",
            "crm_segment",
            "first_order_at",
            "last_order_at",
            "active_days_30",
            "active_days_90",
            "warehouse_partition",
            "ingested_at",
          ],
        },
        {
          name: "dim_regions",
          columns: [
            "region_id",
            "region_name",
            "country_code",
            "timezone_name",
            "market_tier",
            "created_at",
            "updated_at",
            "status",
            "cluster_name",
            "geo_hash",
            "currency_code",
            "tax_region_code",
            "warehouse_partition",
            "ingested_at",
            "region_manager_id",
            "sales_region_code",
            "pricing_region_code",
            "fulfillment_region_code",
            "population_band",
            "language_group",
            "holiday_calendar_id",
            "risk_band",
            "delivery_zone_count",
            "support_zone_count",
            "weather_zone_code",
            "cross_border_enabled",
            "fraud_watch_level",
            "batch_id",
          ],
        },
        {
          name: "dim_subscriptions",
          columns: [
            "subscription_id",
            "user_id",
            "plan_id",
            "status",
            "created_at",
            "updated_at",
            "activated_at",
            "cancelled_at",
            "renewal_at",
            "trial_ends_at",
            "billing_period",
            "billing_provider",
            "currency_code",
            "country_code",
            "device_type",
            "signup_channel",
            "renewal_attempts",
            "discount_code",
            "discount_percent",
            "warehouse_partition",
            "batch_id",
            "source_system",
            "migration_source",
            "grace_period_days",
            "risk_score",
            "is_family_plan",
            "seat_count",
            "ingested_at",
          ],
        },
        {
          name: "dim_plans",
          columns: [
            "plan_id",
            "plan_name",
            "status",
            "created_at",
            "updated_at",
            "billing_period",
            "price_amount",
            "currency_code",
            "country_code",
            "market_tier",
            "device_type",
            "seat_limit",
            "feature_bundle",
            "feature_count",
            "warehouse_partition",
            "batch_id",
            "source_system",
            "is_default",
            "trial_days",
            "grace_period_days",
            "discount_allowed",
            "risk_band",
            "support_tier",
            "fulfillment_tier",
            "analytics_tier",
            "sales_channel",
            "pricing_strategy",
            "ingested_at",
          ],
        },
      ],
    ],
  ])
}

function buildWarehouseState(): WarehouseState {
  const ids: Record<string, Node> = {}
  const rootIds = ["database:warehouse"]
  const counts = { tables: 0, columns: 0 }
  const schemas = ["analytics", "public", "finance", "marketing", "ops"]

  for (const i of Array.from({ length: SCHEMA_COUNT - schemas.length }, (_, i) => i)) {
    schemas.push(`schema_${String(i + 1).padStart(2, "0")}`)
  }

  ids[rootIds[0]] = {
    id: rootIds[0],
    name: "warehouse",
    type: NodeType.DATABASE,
    edges: { schemas: { items: [], truncated: false } },
    attributes: { resource: "bench", engine: "postgres", isDefault: true },
  } as Extract<Node, { type: "database" }>

  const extras = specialTables()

  for (const schemaName of schemas) {
    const schemaId = `schema:${schemaName}`
    ;(ids[rootIds[0]] as Extract<Node, { type: "database" }>).edges.schemas.items.push(schemaId)
    ids[schemaId] = {
      id: schemaId,
      name: schemaName,
      type: NodeType.SCHEMA,
      edges: { tables: { items: [], truncated: false } },
      attributes: { resource: "bench", engine: "postgres", isDefault: schemaName === "public" },
    } as Extract<Node, { type: "schema" }>

    const tables = extras.get(schemaName) ?? []

    for (const table of tables) {
      const tableId = `table:${schemaName}.${table.name}`
      ;(ids[schemaId] as Extract<Node, { type: "schema" }>).edges.tables.items.push(tableId)
      ids[tableId] = {
        id: tableId,
        name: table.name,
        type: NodeType.TABLE,
        edges: { columns: { items: [], truncated: false } },
        attributes: { resource: "bench", table: table.name, tableType: "table" },
      } as Extract<Node, { type: "table" }>
      counts.tables += 1

      for (const [index, columnName] of table.columns.entries()) {
        const columnId = `column:${schemaName}.${table.name}.${columnName}`
        ;(ids[tableId] as Extract<Node, { type: "table" }>).edges.columns.items.push(columnId)
        ids[columnId] = {
          id: columnId,
          name: columnName,
          type: NodeType.COLUMN,
          edges: {},
          attributes: {
            resource: "bench",
            table: table.name,
            column: columnName,
            ordinal: index + 1,
            dataType: columnName.endsWith("_at") ? "timestamp" : columnName.endsWith("_id") ? "integer" : "text",
            notNull: columnName === "id" || columnName.endsWith("_id"),
          },
        } as Extract<Node, { type: "column" }>
        counts.columns += 1
      }
    }

    const fillerCount = TABLES_PER_SCHEMA - tables.length
    for (const i of Array.from({ length: fillerCount }, (_, i) => i)) {
      const suffix = String(i + 1).padStart(3, "0")
      const name =
        i % 4 === 0
          ? `fact_orders_${suffix}`
          : i % 4 === 1
            ? `fact_events_${suffix}`
            : i % 4 === 2
              ? `dim_users_${suffix}`
              : `dim_regions_${suffix}`
      const tableId = `table:${schemaName}.${name}`
      ;(ids[schemaId] as Extract<Node, { type: "schema" }>).edges.tables.items.push(tableId)
      ids[tableId] = {
        id: tableId,
        name,
        type: NodeType.TABLE,
        edges: { columns: { items: [], truncated: false } },
        attributes: { resource: "bench", table: name, tableType: "table" },
      } as Extract<Node, { type: "table" }>
      counts.tables += 1

      const columns = fillerColumns(name)
      for (const [index, columnName] of columns.entries()) {
        const columnId = `column:${schemaName}.${name}.${columnName}`
        ;(ids[tableId] as Extract<Node, { type: "table" }>).edges.columns.items.push(columnId)
        ids[columnId] = {
          id: columnId,
          name: columnName,
          type: NodeType.COLUMN,
          edges: {},
          attributes: {
            resource: "bench",
            table: name,
            column: columnName,
            ordinal: index + 1,
            dataType: columnName.endsWith("_at") ? "timestamp" : columnName.endsWith("_id") ? "integer" : "text",
            notNull: columnName === "id" || columnName.endsWith("_id"),
          },
        } as Extract<Node, { type: "column" }>
        counts.columns += 1
      }
    }
  }

  return {
    state: {
      rootIds,
      nodesById: ids,
      loading: false,
      loaded: true,
    },
    schemas: schemas.length,
    tables: counts.tables,
    columns: counts.columns,
  }
}

function buildOrderByQuery(aliasCount: number) {
  const parts: string[] = []

  for (const i of Array.from({ length: aliasCount }, (_, i) => i)) {
    const suffix = String(i + 1).padStart(3, "0")
    parts.push(`o.created_at as order_created_at_${suffix}`)
    parts.push(`o.status as order_status_${suffix}`)
    parts.push(`u.email as user_email_${suffix}`)
  }

  return [
    "select",
    `  ${parts.join(",\n  ")}`,
    "from analytics.fact_orders o",
    "join analytics.dim_users u on u.user_id = o.user_id",
    "order by order_cre|",
  ].join("\n")
}

function buildCteChainQuery(depth: number) {
  const ctes = ["base as (select order_id, user_id, created_at as order_created_at_00, status from analytics.fact_orders)"]

  for (const i of Array.from({ length: depth }, (_, i) => i + 1)) {
    const prev = i === 1 ? "base" : `s${String(i - 1).padStart(2, "0")}`
    const cur = `s${String(i).padStart(2, "0")}`
    const prevAlias = `order_created_at_${String(i - 1).padStart(2, "0")}`
    const curAlias = `order_created_at_${String(i).padStart(2, "0")}`
    ctes.push(
      `${cur} as (select order_id, user_id, ${prevAlias} as ${curAlias}, status from ${prev})`,
    )
  }

  return `with ${ctes.join(",\n")}\nselect order_created_at_1| from s${String(depth).padStart(2, "0")}`
}

function cases() {
  return [
    {
      name: "global relation lookup",
      sql: "select * from fact_ord|",
    },
    {
      name: "schema relation lookup",
      sql: "select * from analytics.fact_ord|",
    },
    {
      name: "wide join columns",
      sql: [
        "select ord|",
        "from analytics.fact_orders o",
        "join analytics.fact_payments p on p.order_id = o.order_id",
        "join analytics.fact_shipments s on s.order_id = o.order_id",
        "join analytics.fact_refunds r on r.order_id = o.order_id",
        "join analytics.dim_users u on u.user_id = o.user_id",
        "join analytics.dim_regions g on g.region_id = u.region_id",
        "join analytics.dim_subscriptions sub on sub.user_id = u.user_id",
        "join analytics.dim_plans pl on pl.plan_id = sub.plan_id",
        "where o.status = 'paid'",
      ].join("\n"),
    },
    {
      name: "correlated subquery",
      sql: [
        "select *",
        "from analytics.dim_users u",
        "where exists (",
        "  select 1",
        "  from analytics.fact_orders o",
        "  where o.user_id = u.user_id",
        "    and exists (",
        "      select 1",
        "      from analytics.fact_payments p",
        "      where p.order_id = o.order_id",
        "        and exists (",
        "          select 1",
        "          from analytics.fact_refunds r",
        "          where r.order_id = o.order_id",
        "            and u.cre|",
        "        )",
        "    )",
        ")",
      ].join("\n"),
    },
    {
      name: "recursive cte",
      sql: [
        "with recursive seq(level_n) as (",
        "  select 1",
        "  union all",
        "  select level_| + 1",
        "  from seq",
        "  where level_n < 1000",
        ")",
        "select * from seq",
      ].join("\n"),
    },
    {
      name: "order by aliases",
      sql: buildOrderByQuery(80),
    },
    {
      name: "cte chain",
      sql: buildCteChainQuery(14),
    },
  ] satisfies BenchCase[]
}

function sample(provider: ReturnType<typeof createSqlAutocompleteProvider>, query: ReturnType<typeof withCursor>, name: string) {
  const start = Bun.nanoseconds()
  const result = provider.getCompletions({ text: query.text, cursor: query.cursor })
  const end = Bun.nanoseconds()

  if (!result || result.items.length === 0) {
    throw new Error(`Benchmark case returned no completions: ${name}`)
  }

  return {
    ms: Number(end - start) / 1_000_000,
    items: result.items.length,
  }
}

function runBenchCase(state: SqlSchemaInput, benchCase: BenchCase): BenchResult {
  const query = withCursor(benchCase.sql)
  const cold: number[] = []

  for (const _ of Array.from({ length: COLD_RUNS }, (_, i) => i)) {
    const provider = createSqlAutocompleteProvider({ getState: () => state })
    cold.push(sample(provider, query, benchCase.name).ms)
  }

  const provider = createSqlAutocompleteProvider({ getState: () => state })
  for (const _ of Array.from({ length: WARM_UP_RUNS }, (_, i) => i)) {
    sample(provider, query, benchCase.name)
  }

  const warm: number[] = []
  let items = 0
  for (const _ of Array.from({ length: WARM_RUNS }, (_, i) => i)) {
    const result = sample(provider, query, benchCase.name)
    warm.push(result.ms)
    items = result.items
  }

  return {
    name: benchCase.name,
    items,
    coldMedian: percentile(cold, 0.5),
    coldP95: percentile(cold, 0.95),
    warmMedian: percentile(warm, 0.5),
    warmP95: percentile(warm, 0.95),
  }
}

function printResults(results: readonly BenchResult[], warehouse: WarehouseState, totalMs: number) {
  const rows = results.map((result) => [
    result.name,
    String(result.items),
    formatMs(result.coldMedian),
    formatMs(result.coldP95),
    formatMs(result.warmMedian),
    formatMs(result.warmP95),
  ])
  const headers = ["case", "items", "cold median", "cold p95", "warm median", "warm p95"]
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  )

  console.log("SQL autocomplete benchmark")
  console.log(
    `Synthetic warehouse: ${warehouse.schemas} schemas, ${warehouse.tables} tables, ${warehouse.columns} columns`,
  )
  console.log(`Iterations: cold ${COLD_RUNS}, warm-up ${WARM_UP_RUNS}, warm ${WARM_RUNS}`)
  console.log("")
  console.log(headers.map((header, index) => pad(header, widths[index])).join("  "))
  console.log(widths.map((width) => "-".repeat(width)).join("  "))

  for (const row of rows) {
    console.log(row.map((value, index) => pad(value, widths[index])).join("  "))
  }

  console.log("")
  console.log(`Total runtime: ${formatMs(totalMs)}`)
}

function main() {
  const warehouse = buildWarehouseState()
  const start = Bun.nanoseconds()
  const results = cases().map((value) => runBenchCase(warehouse.state, value))
  const totalMs = Number(Bun.nanoseconds() - start) / 1_000_000
  printResults(results, warehouse, totalMs)
}

main()
