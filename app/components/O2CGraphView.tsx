"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  Panel,
  MarkerType,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { forceSimulation, forceManyBody, forceCenter, forceLink, forceCollide } from "d3-force";
import type { GraphData, GraphNode, GraphEdge } from "@/lib/graph";
import type { GraphEntity } from "@/lib/graph/entities";
import { toGraphNodeId } from "@/lib/graph/entities";

type NodeWithPosition = GraphNode & { x: number; y: number };

type GraphProps = {
  focusEntity: GraphEntity | null;
  highlightEntities: GraphEntity[];
};

type CustomNodeData = {
  label: string;
  type: string;
  highlighted: boolean;
  metadata?: Record<string, unknown>;
};

const CustomNode = ({ data }: { data: CustomNodeData }) => {
  const getNodeColor = (type: string) => {
    switch (type) {
      case "product": return "#f97316"; // orange
      case "order": return "#3b82f6"; // blue
      case "delivery": return "#8b5cf6"; // purple
      case "invoice": return "#10b981"; // green
      case "payment": return "#ef4444"; // red
      case "customer": return "#06b6d4"; // cyan
      default: return "#6b7280"; // gray
    }
  };

  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 text-sm font-medium text-white shadow-lg ${
        data.highlighted ? "ring-2 ring-white ring-opacity-75" : ""
      }`}
      style={{
        backgroundColor: getNodeColor(data.type),
        borderColor: data.highlighted ? "#ffffff" : getNodeColor(data.type),
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="target"
        style={{ background: "#fff", border: "2px solid #000" }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        style={{ background: "#fff", border: "2px solid #000" }}
      />
      <div className="text-center">{data.label}</div>
      <div className="text-xs opacity-75 mt-1 capitalize">{data.type}</div>
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};
function applyForceLayout(nodes: GraphNode[], edges: GraphEdge[]): NodeWithPosition[] {
  if (nodes.length === 0) return nodes as NodeWithPosition[];

  console.log("Applying force layout to", nodes.length, "nodes and", edges.length, "edges");

  // Create copies for simulation (d3-force modifies in place)
  const simulationNodes = nodes.map(node => ({
    ...node,
    x: Math.random() * 800 - 400, // Random initial positions
    y: Math.random() * 600 - 300,
  }));

  const simulationLinks = edges.map(edge => ({
    source: edge.source,
    target: edge.target,
  }));

  const simulation = forceSimulation(simulationNodes)
    .force("charge", forceManyBody().strength(-300)) // Push nodes apart (stronger repulsion)
    .force("center", forceCenter(0, 0)) // Center the graph
    .force(
      "link",
      forceLink(simulationLinks)
        .id((d: any) => d.id)
        .distance(180) // Link distance for connected nodes
    )
    .force("collision", forceCollide().radius(70)) // Prevent overlap
    .stop();

  // Run simulation for 150 iterations
  for (let i = 0; i < 150; i++) {
    simulation.tick();
  }

  // Convert back to NodeWithPosition format
  return simulationNodes.map(node => ({
    ...node,
    // Ensure positions are valid numbers
    x: typeof node.x === 'number' && !isNaN(node.x) ? node.x : 0,
    y: typeof node.y === 'number' && !isNaN(node.y) ? node.y : 0,
  }));
}

export function O2CGraphView({ focusEntity, highlightEntities }: GraphProps) {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node<CustomNodeData> | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [showOnlyConnected, setShowOnlyConnected] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CustomNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Convert GraphData to React Flow format with force-directed layout
  const convertToReactFlow = useCallback((graphData: GraphData, highlightedIds: Set<string>) => {
    // Apply force-directed layout to position nodes organically
    const layoutedNodes = applyForceLayout(graphData.nodes, graphData.edges);

    const rfNodes: Node<CustomNodeData>[] = layoutedNodes.map((node) => ({
      id: node.id,
      type: "custom",
      position: {
        x: node.x || 0,
        y: node.y || 0,
      },
      data: {
        label: node.label || node.id,
        type: node.type,
        highlighted: highlightedIds.has(node.id),
      },
      style: { zIndex: 10 }, // Make edges go under nodes
    }));

    // Get connected node IDs for the selected node
    const connectedNodeIds = new Set<string>();
    if (selectedNode) {
      connectedNodeIds.add(selectedNode.id);
      graphData.edges.forEach(edge => {
        if (edge.source === selectedNode.id) {
          connectedNodeIds.add(edge.target);
        } else if (edge.target === selectedNode.id) {
          connectedNodeIds.add(edge.source);
        }
      });
    }

    const rfEdges: Edge[] = graphData.edges
      .filter((edge) => {
        // If showOnlyConnected is enabled and we have a selected node, only show connected edges
        if (showOnlyConnected && selectedNode) {
          return connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target);
        }
        return true;
      })
      .map((edge) => {
        const isConnected = selectedNode && (connectedNodeIds.has(edge.source) || connectedNodeIds.has(edge.target));

        return {
          id: `${edge.source}-${edge.target}`,
          source: edge.source,
          target: edge.target,
          sourceHandle: "source",
          targetHandle: "target",
          type: "straight", // Straight line edges
          style: {
            stroke: isConnected ? "#2563eb" : "#94a3b8",
            strokeWidth: isConnected ? 3 : 2.5,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isConnected ? "#2563eb" : "#94a3b8",
          },
          animated: isConnected || undefined,
        };
      });

    console.log("Edges:", rfEdges.length);

    console.log("ReactFlow Nodes:", rfNodes.length);
    console.log("ReactFlow Edges:", rfEdges.length);

    return { nodes: rfNodes, edges: rfEdges };
  }, []);

  // Generate graph data from entities
  useEffect(() => {
    const loadGraphData = async () => {
      setLoading(true);
      setError(null);
      try {
        const allEntities = [...(focusEntity ? [focusEntity] : []), ...highlightEntities];
        if (allEntities.length === 0) {
          setGraph({ nodes: [], edges: [] });
          return;
        }

        const response = await fetch("/api/graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entities: allEntities }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const graphData = await response.json();
        setGraph(graphData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load graph");
      } finally {
        setLoading(false);
      }
    };

    loadGraphData();
  }, [focusEntity, highlightEntities]);

  // Update React Flow data when graph changes
  useEffect(() => {
    const highlightedIds = new Set(highlightEntities.map(toGraphNodeId));
    const { nodes: rfNodes, edges: rfEdges } = convertToReactFlow(graph, highlightedIds);
    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [graph, highlightEntities, selectedNode, showOnlyConnected, convertToReactFlow, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node<CustomNodeData>) => {
    setSelectedNode(node);
    // Note: Force-directed layout doesn't have a center concept, but we could implement
    // pinning the clicked node to center if desired
  }, []);

  const expandNode = useCallback(async (nodeId: string) => {
    if (expandedNodes.has(nodeId)) return;

    setExpandedNodes(prev => new Set(prev).add(nodeId));

    // Fetch additional connected nodes for the clicked node
    try {
      const response = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entities: [{ type: "unknown", id: nodeId }] }),
      });

      if (response.ok) {
        const newGraphData = await response.json();
        // Merge with existing graph data
        setGraph(prev => ({
          nodes: [...prev.nodes, ...newGraphData.nodes.filter((n: any) => !prev.nodes.find((pn: any) => pn.id === n.id))],
          edges: [...prev.edges, ...newGraphData.edges.filter((e: any) => !prev.edges.find((pe: any) => pe.source === e.source && pe.target === e.target))]
        }));
      }
    } catch (err) {
      console.error("Failed to expand node:", err);
    }
  }, [expandedNodes]);

  const highlightedCount = useMemo(() => {
    return nodes.filter(node => node.data?.highlighted).length;
  }, [nodes]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100">
        <div>
          <h2 className="text-sm font-medium text-zinc-900">Graph</h2>
          <p className="text-xs text-zinc-500">
            {highlightedCount > 0
              ? `${highlightedCount} highlighted entities from your query`
              : "Click nodes to explore connections"}
          </p>
          <p className="text-xs text-zinc-400 mt-1" title="Click on a node to explore its connections. Use the chat to query relationships and highlight relevant entities.">
            💡 Click nodes to explore connections
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          {graph.nodes.length ? (
            <span>
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
          ) : (
            <span>Waiting for a query…</span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {loading ? (
          <div className="h-full flex items-center justify-center text-sm text-zinc-500">
            Loading graph…
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-sm text-red-600">
            {error}
          </div>
        ) : !graph.nodes.length ? (
          <div className="h-full flex items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50/60 text-sm text-zinc-400">
            Ask something on the right.
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Controls />
            <Background color="#f8fafc" gap={20} size={1} style={{ opacity: 0.3 }} />
            <MiniMap />

            {selectedNode && (
              <Panel position="top-right" className="bg-white p-4 rounded-lg shadow-lg border max-w-sm">
                <h3 className="font-medium text-zinc-900 mb-2">Node Details</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium">ID:</span> {selectedNode.id}
                  </div>
                  <div>
                    <span className="font-medium">Type:</span>{" "}
                    <span className="capitalize">{selectedNode.data?.type}</span>
                  </div>
                  <div>
                    <span className="font-medium">Label:</span> {selectedNode.data?.label}
                  </div>
                  {selectedNode.data?.highlighted && (
                    <div className="text-amber-600 font-medium">✓ Highlighted from query</div>
                  )}
                </div>
                <button
                  onClick={() => expandNode(selectedNode.id)}
                  className="mt-3 px-3 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
                  disabled={expandedNodes.has(selectedNode.id)}
                >
                  {expandedNodes.has(selectedNode.id) ? "Expanded" : "Expand Connections"}
                </button>
                <button
                  onClick={() => setShowOnlyConnected(!showOnlyConnected)}
                  className={`mt-2 px-3 py-1 text-xs rounded ${
                    showOnlyConnected
                      ? "bg-green-500 text-white hover:bg-green-600"
                      : "bg-gray-500 text-white hover:bg-gray-600"
                  }`}
                >
                  {showOnlyConnected ? "Show All Edges" : "Show Connected Only"}
                </button>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="mt-2 ml-2 px-3 py-1 bg-zinc-500 text-white text-xs rounded hover:bg-zinc-600"
                >
                  Close
                </button>
              </Panel>
            )}
          </ReactFlow>
        )}
      </div>
    </section>
  );
}

