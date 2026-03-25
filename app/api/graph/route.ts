import { NextResponse } from "next/server";
import { getGraphData, getConnectedGraphData } from "@/lib/graph";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");

    if (!entityType?.trim() || !entityId?.trim()) {
      return NextResponse.json(
        {
          error:
            "Missing required query parameters: entityType and entityId must be non-empty strings",
        },
        { status: 400 }
      );
    }

    const graph = await getGraphData(entityType, entityId);
    return NextResponse.json(graph);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    const misconfiguredEnv =
      message.includes("NEXT_PUBLIC_SUPABASE") ||
      message.includes(".env.local") ||
      message.includes("Supabase env");

    return NextResponse.json(
      { error: message },
      { status: misconfiguredEnv ? 503 : 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const entities = body.entities;
    console.log("Graph API POST called with entities:", entities);

    if (!Array.isArray(entities)) {
      return NextResponse.json(
        {
          error: "Body must contain an 'entities' array",
        },
        { status: 400 }
      );
    }

    const graph = await getConnectedGraphData(entities);
    console.log("Graph API returning graph:", { nodes: graph.nodes.length, edges: graph.edges.length });
    return NextResponse.json(graph);
  } catch (e) {
    console.error("Graph API error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
