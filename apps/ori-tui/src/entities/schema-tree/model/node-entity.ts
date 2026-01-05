import type { Node, NodeEdge } from "@shared/lib/configurations-client";

export type NodeEntity = SnapshotNodeEntity | EdgeNodeEntity;

type BaseNodeEntity = {
  id: string;
  kind: "node" | "edge";
  label: string;
  icon?: string;
  description?: string;
  badges?: string;
  childIds: string[];
  hasChildren: boolean;
};

// SnapshotNodeEntity represents a node that represents an actual node
// from a snapshot that we retrieved from backend
export interface SnapshotNodeEntity extends BaseNodeEntity {
  kind: "node";
  node: Node;
}

// EdgeNodeEntity represents a node that doesn't exist in the snapshot
// and that we introduced for display purposes
export interface EdgeNodeEntity extends BaseNodeEntity {
  kind: "edge";
  sourceNodeId: string;
  edgeName: string;
  truncated: boolean;
}

export function buildNodeEntityMap(nodes: Map<string, Node>): Map<string, NodeEntity> {
  const map = new Map<string, NodeEntity>();

  for (const node of nodes.values()) {
    map.set(node.id, createSnapshotNodeEntity(node));
  }

  for (const node of nodes.values()) {
    const parent = map.get(node.id);
    if (!parent || parent.kind !== "node") {
      continue;
    }
    for (const [edgeName, edge] of Object.entries(node.edges ?? {})) {
      if (!edge.items || edge.items.length === 0) {
        continue;
      }
      const edgeEntity = createEdgeNodeEntity(node, edgeName, edge);
      map.set(edgeEntity.id, edgeEntity);
      parent.childIds.push(edgeEntity.id);
      parent.hasChildren = parent.childIds.length > 0;
    }
  }

  return map;
}

function createSnapshotNodeEntity(node: Node): SnapshotNodeEntity {
  return {
    id: node.id,
    kind: "node",
    node,
    label: node.name,
    icon: iconForNode(node),
    description: describeNode(node),
    badges: nodeBadges(node),
    childIds: [],
    hasChildren: false,
  };
}

function createEdgeNodeEntity(node: Node, edgeName: string, edge: NodeEdge): EdgeNodeEntity {
  const childIds = edge.items.slice();
  return {
    id: edgeEntityId(node.id, edgeName),
    kind: "edge",
    sourceNodeId: node.id,
    edgeName,
    label: edgeLabel(edgeName),
    description: describeEdge(edge),
    childIds,
    hasChildren: childIds.length > 0,
    truncated: edge.truncated,
  };
}

function edgeEntityId(nodeId: string, edgeName: string): string {
  return `edge:${nodeId}:${edgeName}`;
}

function edgeLabel(edgeName: string): string {
  return edgeName;
}

function describeEdge(edge: NodeEdge): string | undefined {
  const count = edge.items.length;
  if (count === 0 && !edge.truncated) {
    return undefined;
  }
  const suffix = count === 1 ? "item" : "items";
  const baseCount = formatEdgeCount(count, edge.truncated);
  return `${baseCount} ${suffix} ${edge.truncated ? "(truncated)" : ""}`.trim()
}

function formatEdgeCount(count: number, truncated: boolean): string {
  if (count > 0) {
    return truncated ? `${count}+` : String(count);
  }
  if (truncated) {
    return "+";
  }
  return "0";
}

function iconForNode(node: Node): string {
  switch (node.type) {
    case "database":
      return "";
    case "table":
      return "▥";
    case "view":
      return "▥";
    case "column":
      return "≡";
    case "constraint":
      return "▸";
    default:
      return "▸";
  }
}

function describeNode(node: Node): string | undefined {
  switch (node.type) {
    case "database":
      return "database";
    case "table":
    case "view":
      return node.attributes?.table ?? undefined;
    case "column":
      return node.attributes?.dataType ?? undefined;
    case "constraint":
      return node.attributes?.constraintType ?? undefined;
    default:
      return undefined;
  }
}

function nodeBadges(node: Node): string | undefined {
  if (node.type === "column") {
    const badges: string[] = [];
    if (node.attributes?.primaryKeyPosition && node.attributes.primaryKeyPosition > 0) {
      badges.push("PK");
    }
    if (node.attributes?.notNull) {
      badges.push("NOT NULL");
    }
    return badges.length > 0 ? badges.join(" • ") : undefined;
  }
  return undefined;
}
