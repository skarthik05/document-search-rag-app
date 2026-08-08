import type { RetrievedSource } from "./types";

const provider = () =>
  process.env.AI_PROVIDER?.trim().toLowerCase() === "openai"
    ? "openai"
    : "gemini";
const key = () =>
  provider() === "openai"
    ? process.env.OPENAI_API_KEY
    : process.env.GEMINI_API_KEY;
const geminiModel = () =>
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const noKey = () => {
  if (!key())
    throw new Error(
      `Missing ${provider() === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"}. Add it to .env.local.`,
    );
};

export async function embed(
  input: string,
  taskType?: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
) {
  noKey();
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
    return `You are a strict document-evidence verifier. Using ONLY the source passages below, decide whether they directly answer or materially support the user's question. Do not use outside knowledge. Return exactly valid JSON with this shape: {"hasEnoughInformation":true,"relevantSourceIds":["Source 1"]}. Set hasEnoughInformation to false and use an empty relevantSourceIds array when the document does not contain adequate evidence to answer the question.\n\nQuestion: ${question}\n\nSources:\n${context}`;
  if (task === "summary")
    return `Summarize only the relevant document passages below in relation to the user's question. Do not add facts, assumptions, or outside knowledge. Cite each factual statement with source labels like [Source 1]. If the passages do not contain enough information, say exactly: "The uploaded document does not contain enough information to answer this question."\n\nQuestion: ${question}\n\nSources:\n${context}`;
  return `Answer the question using ONLY the sources below. Cite claims with source labels like [Source 1]. If the sources do not contain enough information to answer the question, say exactly: "The uploaded document does not contain enough information to answer this question." Do not use outside knowledge.\n\nQuestion: ${question}\n\nSources:\n${context}`;
}

export async function complete(
  question: string,
  sources: RetrievedSource[],
  task: "answer" | "refine" | "verify",
) {
  noKey();
  const text = prompt(question, sources, task);
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

export async function streamingAnswer(
  question: string,
  sources: RetrievedSource[],
  task: "answer" | "summary" = "answer",
) {
  noKey();
  const text = prompt(question, sources, task);
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
