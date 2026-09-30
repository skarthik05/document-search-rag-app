import type { RetrievedSource } from "./types";
import { calculate } from "./calculator";
import { clearLine } from "readline";

type CalculatorResult = {
  expression: string;
  value: number;
  directAnswer?: string;
};

const provider = () => {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  return configured === "openai" || configured === "gemini"
    ? configured
    : "ollama";
};
const key = () =>
  provider() === "openai" ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;
const ollamaBaseUrl = () =>
  (process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434").replace(/\/$/, "");
const ollamaEmbeddingModel = () =>
  process.env.OLLAMA_EMBEDDING_MODEL?.trim() || "nomic-embed-text";
const ollamaLlmModel = () => process.env.OLLAMA_LLM_MODEL?.trim() || "llama3.2";
const geminiModel = () =>
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const noKey = () => {
  if (provider() !== "ollama" && !key())
    throw new Error(
      `Missing ${provider() === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"}. Add it to .env.local.`,
    );
  console.log(`Using ${provider()} provider with model: ${provider() === "ollama" ? ollamaLlmModel() : provider() === "openai" ? "gpt-4.1-mini" : geminiModel()}`);
};

export async function embed(
  input: string,
  taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
) {
  noKey();
  if (provider() === "ollama") {
    const response = await fetch(`${ollamaBaseUrl()}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ollamaEmbeddingModel(), input }),
    });
    const json = await response.json();
    if (!response.ok)
      throw new Error(json.error || "Ollama embedding failed");
    return json.embeddings[0] as number[];
  }
  if (provider() === "openai") {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input }),
    });
    const json = await response.json();
    if (!response.ok)
      throw new Error(json.error?.message || "OpenAI embedding failed");
    return json.data[0].embedding as number[];
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text: input }] },
        ...(taskType ? { taskType } : {}),
      }),
    },
  );
  const json = await response.json();
  if (!response.ok)
    throw new Error(json.error?.message || "Gemini embedding failed");
  return json.embedding.values as number[];
}

function prompt(
  question: string,
  sources: RetrievedSource[],
  task: "answer" | "summary" | "refine" | "verify",
) {
  const context = sources
    .map((s) => `[${s.sourceId}]${s.page ? ` (page ${s.page})` : ""} ${s.text}`)
    .join("\n\n");
  if (task === "refine") {
    const sourceBlock = context
      ? `\nInitial retrieved passages:\n${context}`
      : "\nNo passages were retrieved yet.";
    return `You help refine document search queries. Return ONLY a concise search query (no explanation) that will retrieve passages answering the user's question. Preserve the user's intent.${sourceBlock}\n\nUser question: ${question}`;
  }
  if (task === "verify")
    return `Determine whether the sources contain the answer to the question. If any source explicitly states the requested fact or directly supports it, set hasEnoughInformation to true and list that source's ID exactly as shown. Set it to false only when none of the sources contains evidence for an answer. Do not require extra details beyond what the question asks, and do not use outside knowledge. Return only a JSON object with the keys hasEnoughInformation (boolean) and relevantSourceIds (array of exact source ID strings). Do not include markdown or explanation.\n\nQuestion: ${question}\n\nSources:\n${context}`;
  if (task === "summary")
    return `Summarize only the relevant document passages below in relation to the user's question. Do not add facts, assumptions, or outside knowledge. Cite each factual statement with source labels like [Source 1]. If the passages do not contain enough information, say exactly: "The uploaded document does not contain enough information to answer this question."\n\nQuestion: ${question}\n\nSources:\n${context}`;
  return `Answer the question directly using ONLY the sources below. First decide whether at least one source supports an answer. If any source supports the answer, give only the answer in 1-2 concise sentences and cite it, for example [Source 1]. In that case, do not say that information is missing and do not include the fallback sentence. Do not introduce or restate the question, describe the passages, or quote source text unless the user asks for a quote. Only when none of the sources supports an answer, output exactly: "The uploaded document does not contain enough information to answer this question." Never give both an answer and the fallback. Do not use outside knowledge.\n\nQuestion: ${question}\n\nSources:\n${context}`;
}

export async function complete(
  question: string,
  sources: RetrievedSource[],
  task: "answer" | "refine" | "verify",
) {
  noKey();
  const text = prompt(question, sources, task);
  if (provider() === "ollama") {
    const verificationFormat =
      task === "verify"
        ? {
          type: "object",
          properties: {
            hasEnoughInformation: { type: "boolean" },
            relevantSourceIds: {
              type: "array",
              items: {
                type: "string",
                enum: sources.map((source) => source.sourceId),
              },
            },
          },
          required: ["hasEnoughInformation", "relevantSourceIds"],
          additionalProperties: false,
        }
        : undefined;
    const response = await fetch(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaLlmModel(),
        prompt: text,
        stream: false,
        ...(verificationFormat
          ? { format: verificationFormat, options: { temperature: 0 } }
          : {}),
      }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Ollama request failed");
    return json.response as string;
  }
  if (provider() === "openai") {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: text }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || "OpenAI request failed");
    return j.output_text as string;
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${key()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
    },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "Gemini request failed");
  return j.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export async function verifyEvidence(
  question: string,
  sources: RetrievedSource[],
) {
  const raw = await complete(question, sources, "verify");
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json)
    return { hasEnoughInformation: false, relevantSourceIds: [] as string[] };
  try {
    const value = JSON.parse(json) as {
      hasEnoughInformation?: boolean;
      relevantSourceIds?: unknown;
    };
    const allowed = new Map(
      sources.map((source) => [source.sourceId.toLowerCase(), source.sourceId]),
    );
    const normalizeSourceId = (id: string) => {
      const direct = allowed.get(id.toLowerCase());
      if (direct) return direct;
      const legacy = id.match(/^S(\d+)$/i);
      if (legacy) return allowed.get(`source ${legacy[1]}`);
      const spaced = id.match(/^source\s*(\d+)$/i);
      if (spaced) return allowed.get(`source ${spaced[1]}`);
      return undefined;
    };
    const relevantSourceIds = Array.isArray(value.relevantSourceIds)
      ? [
        ...new Set(
          value.relevantSourceIds
            .filter((id): id is string => typeof id === "string")
            .map(normalizeSourceId)
            .filter((id): id is string => Boolean(id)),
        ),
      ]
      : [];
    return {
      hasEnoughInformation:
        value.hasEnoughInformation === true && relevantSourceIds.length > 0,
      relevantSourceIds,
    };
  } catch {
    return { hasEnoughInformation: false, relevantSourceIds: [] as string[] };
  }
}

export async function requestCalculatorTool(
  question: string,
  sources: RetrievedSource[],
): Promise<CalculatorResult | undefined> {
  noKey();
  const chunkTotal = question.match(/\bacross\s+(\d+)\s+chunks?\b/i);
  if (chunkTotal && /\bfull\s+size\b/i.test(question)) {
    const source = sources.find((candidate) =>
      /\bchunks?\s+of\s+[\d,]+\s+characters?\b/i.test(candidate.text),
    );
    const chunkSize = source?.text.match(
      /\bchunks?\s+of\s+([\d,]+)\s+characters?\b/i,
    )?.[1];
    if (source && chunkSize) {
      const expression = `${chunkTotal[1]} * ${chunkSize.replace(/,/g, "")}`;
      const value = calculate(expression);
      // const directAnswer = `There are ${value.toLocaleString()} characters across ${chunkTotal[1]} chunks [${source.sourceId}].`;
      console.info("[tool:calculator] deterministic_calculation", {
        expression,
        value,
        sourceId: source.sourceId,
      });
      return { expression, value };
    }
  }

  if (provider() !== "ollama") {
    console.info("[tool:calculator] skipped", { reason: "provider_not_supported", provider: provider() });
    return undefined;
  }

  const startedAt = Date.now();
  console.info("[tool:calculator] selection_started", {
    provider: provider(),
    model: ollamaLlmModel(),
    sourceCount: sources.length,
  });

  try {
    const response = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaLlmModel(),
        stream: false,
        messages: [
          {
            role: "user",
            content: `${prompt(question, sources, "answer")}\n\nIf answering requires arithmetic, call the calculator tool. Otherwise, answer without a tool.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "calculator",
              description: "Evaluate a basic arithmetic expression.",
              parameters: {
                type: "object",
                properties: {
                  expression: {
                    type: "string",
                    description: "Arithmetic using numbers, +, -, *, /, and parentheses.",
                  },
                },
                required: ["expression"],
              },
            },
          },
        ],
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      console.error("[tool:calculator] selection_failed", {
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw new Error(json.error || "Ollama tool request failed");
    }

    const calls = json.message?.tool_calls;
    const call = Array.isArray(calls)
      ? calls.find((item) => item.function?.name === "calculator")
      : undefined;
    const expression = call?.function?.arguments?.expression;
    if (typeof expression !== "string") {
      console.info("[tool:calculator] not_selected", {
        durationMs: Date.now() - startedAt,
        returnedToolCallCount: Array.isArray(calls) ? calls.length : 0,
      });
      return undefined;
    }

    console.info("[tool:calculator] call_received", {
      expression,
      durationMs: Date.now() - startedAt,
    });
    const value = calculate(expression);
    console.info("[tool:calculator] execution_succeeded", { value });
    return { expression, value };
  } catch (error) {
    console.error("[tool:calculator] execution_failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

export async function streamingAnswer(
  question: string,
  sources: RetrievedSource[],
  task: "answer" | "summary" = "answer",
  calculatorResult?: CalculatorResult,
) {
  noKey();
  const basePrompt = prompt(question, sources, task);
  const answerInstructions =
    task === "answer"
      ? `${calculatorResult ? `\n\nA calculator tool evaluated ${calculatorResult.expression} and returned ${calculatorResult.value}. Treat this as a grounded calculation from the question and retrieved information. If it answers the question, use the result, cite the source passage that supplies the input value, and do not abstain.` : ""}\n\nOutput format: Return only the concise answer and its source citation. Do not include an introduction, repeat the question, explain that you are answering, or show calculation steps unless the user asks for them.`
      : "";
  const text = `${basePrompt}${answerInstructions}`;
  if (provider() === "ollama")
    return fetch(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ollamaLlmModel(), prompt: text, stream: true }),
    });
  if (provider() === "openai")
    return fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: text,
        stream: true,
      }),
    });
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:streamGenerateContent?alt=sse&key=${key()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
    },
  );
}
export const activeProvider = provider;
