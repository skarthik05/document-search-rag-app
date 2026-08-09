"use client";

import { useEffect, useRef, useState } from "react";

import {
  clearActiveDocument,
  getActiveDocument,
  saveActiveDocument,
} from "../lib/document-store";
import { extractChunks } from "../lib/extract-text";
import {
  buildBM25Index,
  filterRelevantCandidates,
  mergeRetrievedSources,
  NO_INFORMATION_MESSAGE,
  retrieve,
} from "../lib/retrieval";
import type {
  RetrievedSource,
  SearchMode,
  StoredDocument,
} from "../lib/types";

async function embed(
  input: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
) {
  const r = await fetch("/api/embed", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input,
      taskType,
    }),
  });

  const j = await r.json();

  if (!r.ok) throw new Error(j.error);

  return j.embedding as number[];
}

async function request(path: string, body: unknown) {
  const r = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const j = await r.json();

  if (!r.ok) throw new Error(j.error);

  return j;
}

function renderAnswerWithCitations(answer: string) {
  const parts = answer.split(/(\[Source \d+\])/g);
  return parts.map((part, index) => {
    const match = part.match(/^\[Source (\d+)\]$/);
    if (!match) return part;
    return (
      <a key={index} href={`#source-${match[1]}`} className="citation">
        {part}
      </a>
    );
  });
}


export function DocumentSearchApp() {
  const [document, setDocument] = useState<StoredDocument | null>(null);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<RetrievedSource[]>([]);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const searchId = useRef(0);

  useEffect(() => {
    getActiveDocument().then(setDocument);
  }, []);

  async function upload(file?: File) {
    if (!file) return;

    if (
      document &&
      !confirm(
        "Uploading a new document will replace the current document and its search data. Continue?"
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setStatus("Extracting text…");

    try {
      const raw = await extractChunks(file);

      if (!raw.length) {
        throw new Error("This file does not contain readable text.");
      }

      if (raw.length > 80) {
        throw new Error(
          "Please use a shorter document (maximum 80 passages for this MVP)."
        );
      }

      const chunks = [];

      for (let i = 0; i < raw.length; i++) {
        setStatus(`Indexing passage ${i + 1} of ${raw.length}…`);

        chunks.push({
          id: crypto.randomUUID(),
          ...raw[i],
          embedding: await embed(raw[i].text, "RETRIEVAL_DOCUMENT"),
        });
      }
      const bm25Index =
        buildBM25Index(
          chunks,
        );
      const next = {
        id: crypto.randomUUID(),
        filename: file.name,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        chunks,
        bm25Index,
      };

      await saveActiveDocument(next);

      setDocument(next);
      setSources([]);
      setAnswer("");
      setStatus("Document is ready for search.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setStatus("");
    } finally {
      setBusy(false);

      if (input.current) {
        input.current.value = "";
      }
    }
  }

  async function search(mode: SearchMode) {
    if (!document || !query.trim()) return;

    const currentSearch = ++searchId.current;
    const question = query.trim();

    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);

    try {
      setStatus(
        mode === "agent"
          ? "Interpreting question and retrieving sources…"
          : "Retrieving relevant passages…",
      );

      let queryEmbedding = await embed(question, "RETRIEVAL_QUERY");
      let candidates = retrieve(document.chunks, queryEmbedding, question, document.bm25Index, 8);

      if (mode === "agent") {
        let searchQuery = question;

        for (let round = 0; round < 2; round++) {
          setStatus(
            round === 0
              ? "Refining search query…"
              : "Refining search query again…",
          );

          const seed = filterRelevantCandidates(
            candidates,
            document.bm25Index,
            3
          );
          const { query: refined } = await request("/api/refine", {
            question: searchQuery,
            sources: seed,
          });

          const nextQuery = refined?.trim();
          if (!nextQuery || nextQuery.toLowerCase() === searchQuery.toLowerCase()) {
            break;
          }

          searchQuery = nextQuery;
          queryEmbedding = await embed(searchQuery, "RETRIEVAL_QUERY");
          candidates = mergeRetrievedSources(
            candidates,
            retrieve(document.chunks, queryEmbedding, searchQuery, document.bm25Index, 8),
          );
        }
      }

      let found = filterRelevantCandidates(
        candidates,
        document.bm25Index,
      );

      if (currentSearch !== searchId.current) return;

      if (!found.length) {
        setAnswer(NO_INFORMATION_MESSAGE);
        setStatus(NO_INFORMATION_MESSAGE);
        return;
      }

      if (mode !== "quick") {
        setStatus("Checking whether the document contains enough evidence…");

        const verdict = await request("/api/relevance", {
          question,
          sources: found,
        });

        found = found.filter((source) =>
          verdict.relevantSourceIds?.includes(source.sourceId),
        );

        if (!verdict.hasEnoughInformation || !found.length) {
          setAnswer(NO_INFORMATION_MESSAGE);
          setStatus(NO_INFORMATION_MESSAGE);
          return;
        }
      }

      setSources(found);

      if (mode === "quick") {
        setStatus(
          `${found.length} relevant passage${found.length === 1 ? "" : "s"} found.`,
        );
        return;
      }

      setStatus(
        mode === "summary"
          ? "Generating a grounded summary…"
          : "Generating a grounded answer…",
      );

      const response = await fetch("/api/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          sources: found,
          mode,
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);

        throw new Error(
          detail?.error || "Could not start the answer stream.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let raw = "";
      let output = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        raw += decoder.decode(value, {
          stream: true,
        });

        const events = raw.split(/\r?\n\r?\n/);
        raw = events.pop() || "";

        for (const event of events) {
          const line = event
            .split(/\r?\n/)
            .find((x) => x.startsWith("data:"));

          if (!line) continue;

          try {
            const data = JSON.parse(line.replace(/^data:\s*/, ""));

            if (data.delta) {
              output += data.delta;
              setAnswer(output);
            }
          } catch {
            /* malformed stream chunk */
          }
        }
      }

      if (currentSearch === searchId.current) {
        setStatus(
          mode === "summary" ? "Summary complete." : "Answer complete.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header>
        <p className="eyebrow">DOCUMENT-GROUNDED AI</p>

        <h1>Search your document, with sources.</h1>

        <p className="muted">
          One active .txt or text-based PDF, retained in this browser for 24
          hours.
        </p>
      </header>

      <section className="card upload">
        <div>
          <strong>
            {document ? document.filename : "No document uploaded"}
          </strong>

          <p>
            {document
              ? `Expires ${new Date(
                document.expiresAt
              ).toLocaleString()}`
              : "Upload a document to begin."}
          </p>
        </div>

        <label className="button secondary">
          {document ? "Replace document" : "Upload document"}

          <input
            ref={input}
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </label>
      </section>

      <section className="card">
        <textarea
          rows={3}
          value={query}
          disabled={!document || busy}
          placeholder="Ask a question about the active document…"
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="actions">
          <button
            disabled={!document || !query.trim() || busy}
            onClick={() => search("quick")}
          >
            Quick search
          </button>

          <button
            disabled={!document || !query.trim() || busy}
            onClick={() => search("summary")}
          >
            Search & summarize
          </button>

          <button
            disabled={!document || !query.trim() || busy}
            onClick={() => search("agent")}
          >
            Agent search
          </button>
        </div>
      </section>

      {(status || error) && (
        <p className={error ? "notice error" : "notice"}>
          {error || status}
        </p>
      )}

      <section className="grid">
        <article className="card output">
          <div className="panel-title">
            <h2>LLM output</h2>

            {answer && (
              <button
                className="copy"
                onClick={() =>
                  navigator.clipboard.writeText(answer)
                }
              >
                Copy
              </button>
            )}
          </div>

          <p className={answer ? "answer" : "muted"}>
            {answer
              ? renderAnswerWithCitations(answer)
              : "A grounded response will appear here."}
          </p>
        </article>

        <article className="card">
          <h2>Retrieved documents</h2>

          {sources.length ? (
            <ol className="sources">
              {sources.map((s) => (
                <li key={s.id} id={s.sourceId.replace(/\s+/g, "-").toLowerCase()}>
                  <strong>
                    [{s.sourceId}] {document?.filename}
                    {s.page ? ` · Page ${s.page}` : ""}
                  </strong>

                  <span>Relevance: {(s.denseScore * 100).toFixed(1)}%</span>

                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              Matching passages will appear here.
            </p>
          )}
        </article>
      </section>

      {document && (
        <button
          className="clear"
          onClick={async () => {
            await clearActiveDocument();

            setDocument(null);
            setSources([]);
            setAnswer("");
            setStatus("Document removed.");
          }}
        >
          Remove active document
        </button>
      )}
    </div>
  );
}