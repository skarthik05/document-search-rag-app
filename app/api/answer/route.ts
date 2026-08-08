import { streamingAnswer } from "../../../lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readDelta(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as { delta?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.delta || data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

export async function POST(request: Request) {
  try {
    const { question, sources, mode } = await request.json();
    const upstream = await streamingAnswer(question, sources, mode === "summary" ? "summary" : "answer");
    if (!upstream.ok || !upstream.body) {
      const body = await upstream.text(); let message = "AI request failed";
      try { message = JSON.parse(body).error?.message || message; } catch { /* preserve fallback */ }
      return Response.json({ error: message }, { status: upstream.status || 500 });
    }

    const encoder = new TextEncoder(), decoder = new TextDecoder();
    let buffer = "";
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || "";
            for (const event of events) {
              // Gemini formats one SSE JSON payload across several lines. Keep the
              // whole event after its data prefix rather than only its first line.
              const dataStart = event.match(/^data:\s*/m);
              if (!dataStart || dataStart.index === undefined) continue;
              const raw = event.slice(dataStart.index + dataStart[0].length).trim();
              if (raw === "[DONE]") continue;
              try { const delta = readDelta(JSON.parse(raw)); if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); } catch { /* incomplete/malformed provider event */ }
            }
          }
          if (buffer.trim()) {
            const dataStart = buffer.match(/^data:\s*/m);
            const raw = dataStart?.index === undefined ? undefined : buffer.slice(dataStart.index + dataStart[0].length).trim();
            if (raw) { try { const delta = readDelta(JSON.parse(raw)); if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); } catch {} }
          }
          controller.close();
        } catch (error) { controller.error(error); }
      }
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Answer failed" }, { status: 500 }); }
}
