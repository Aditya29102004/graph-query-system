/** Shared graph shapes for queries and visualization. */

export type GraphNodeId = string;

export type GraphNode = {
  id: GraphNodeId;
  label: string;
  metadata?: Record<string, unknown>;
};

export type GraphEdge = {
  source: GraphNodeId;
  target: GraphNodeId;
  label?: string;
};

export type GraphSnapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
