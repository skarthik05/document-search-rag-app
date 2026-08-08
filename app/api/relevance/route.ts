import { NextResponse } from "next/server";
import { verifyEvidence } from "../../../lib/ai-provider";

export async function POST(request: Request) {
  try {
    const { question, sources } = await request.json();
    return NextResponse.json(await verifyEvidence(question, sources));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Evidence check failed" }, { status: 500 });
  }
}
