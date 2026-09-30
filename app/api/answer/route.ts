import {
  activeProvider,
  requestCalculatorTool,
  streamingAnswer,
} from "../../../lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readDelta(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as { delta?: string; response?: string; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.delta || data.response || data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";

}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const { question, sources, mode } = await request.json();
    const requestedTask = mode === "summary" ? "summary" : "answer";
    console.info("[answer] request_started", {
      provider: activeProvider(),
      task: requestedTask,
      sourceCount: Array.isArray(sources) ? sources.length : 0,
    });
    const calculatorResult = await requestCalculatorTool(question, sources)
    const task = calculatorResult ? "answer" : requestedTask;
    console.info("[answer] generation_task_selected", {
      requestedTask,
      task,
      calculatorUsed: Boolean(calculatorResult),
    });
    const upstream = await streamingAnswer(
      question,
      sources,
      task,
      calculatorResult,
    );
    if (!upstream.ok || !upstream.body) {
      const body = await upstream.text(); let message = "AI request failed";
      try { message = JSON.parse(body).error?.message || message; } catch { /* preserve fallback */ }
      console.error("[answer] upstream_failed", {
        provider: activeProvider(),
        status: upstream.status,
        durationMs: Date.now() - startedAt,
      });
      return Response.json({ error: message }, { status: upstream.status || 500 });
    }

    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const isOllama = activeProvider() === "ollama";
    let buffer = "";
    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (isOllama) {
              const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
              for (const line of lines) {
                if (!line.trim()) continue;
                try { const delta = readDelta(JSON.parse(line)); if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); } catch { /* malformed provider event */ }
              }
              continue;
            }
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
          if (isOllama && buffer.trim()) {
            try { const delta = readDelta(JSON.parse(buffer)); if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); } catch { /* malformed provider event */ }
          } else if (buffer.trim()) {
            const dataStart = buffer.match(/^data:\s*/m);
            const raw = dataStart?.index === undefined ? undefined : buffer.slice(dataStart.index + dataStart[0].length).trim();
            if (raw) { try { const delta = readDelta(JSON.parse(raw)); if (delta) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)); } catch { } }
          }
          controller.close();
          console.info("[answer] stream_completed", {
            provider: activeProvider(),
            durationMs: Date.now() - startedAt,
          });
        } catch (error) {
          console.error("[answer] stream_failed", {
            provider: activeProvider(),
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          controller.error(error);
        }
      }
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
  } catch (error) {
    console.error("[answer] request_failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: error instanceof Error ? error.message : "Answer failed" }, { status: 500 });
  }
}
