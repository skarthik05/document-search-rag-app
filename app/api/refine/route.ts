import { NextResponse } from "next/server";
import { complete } from "../../../lib/ai-provider";
export async function POST(request: Request) {
  try { const { question, sources } = await request.json(); return NextResponse.json({ query: await complete(question, sources, "refine") }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Refinement failed" }, { status: 500 }); }
}
