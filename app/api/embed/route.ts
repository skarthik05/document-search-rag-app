import { NextResponse } from "next/server";
import { embed, activeProvider } from "../../../lib/ai-provider";
export async function POST(request: Request) {
  try {
    const { input, taskType } = await request.json();
    if (!input || typeof input !== "string")
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    return NextResponse.json({
      embedding: await embed(input, taskType),
      provider: activeProvider(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Embedding failed" },
      { status: 500 },
    );
  }
}
