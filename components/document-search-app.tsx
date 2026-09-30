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
  NO_INFORMATION_MESSAGE,
  retrieve,
  retrievalImproved,
  shouldStopQueryRefinement,
  evaluateRetrievalConfidence,
} from "../lib/retrieval";
import type {
  SearchMode,
  StoredDocument,
} from "../lib/types";
import type { ConversationTurn, LongTermMemory } from "../lib/conversation-types";
import {
  addLongTermMemory,
  clearConversation,
  deleteLongTermMemory,
  getConversation,
  getLongTermMemories,
  pruneExpiredConversations,
  saveConversation,
} from "../lib/memory-store";
import {
  MAX_ANSWER_CONTEXT_TURNS,
  MAX_CONVERSATION_TURNS,
  MAX_RETRIEVAL_CONTEXT_TURNS,
} from "../lib/memory-limits";
import { ConversationPanel, QuestionComposer } from "./conversation-ui";
import { MemoryPanel } from "./memory-panel";
function elapsed(start: number) {
  return `${(performance.now() - start).toFixed(0)}ms`;
}
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

export function DocumentSearchApp() {
  const [document, setDocument] = useState<StoredDocument | null>(null);
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [longTermMemories, setLongTermMemories] = useState<LongTermMemory[]>([]);
  const [mode, setMode] = useState<SearchMode>("agent");
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const searchId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function restoreMemory() {
      await pruneExpiredConversations();
      const [activeDocument, memories] = await Promise.all([
        getActiveDocument(),
        getLongTermMemories(),
      ]);
      if (cancelled) return;

      setDocument(activeDocument);
      setLongTermMemories(memories);
      if (activeDocument) {
        setTurns(
          await getConversation(activeDocument.id, activeDocument.expiresAt),
        );
      }
    }
    void restoreMemory();
    return () => {
      cancelled = true;
    };
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
      if (document) await clearConversation(document.id);

      setDocument(next);
      setTurns([]);
      setOpenEvidence({});
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

  function startNewConversation() {
    if (document) void clearConversation(document.id);
    setTurns([]);
    setOpenEvidence({});
    setError("");
    setStatus("");
  }

  async function removeDocument() {
    if (document) await clearConversation(document.id);
    await clearActiveDocument();
    setDocument(null);
    setTurns([]);
    setOpenEvidence({});
    setStatus("Document removed.");
  }

  async function search(mode: SearchMode) {
    if (!document || !query.trim()) return;

    const currentSearch = ++searchId.current;
    const question = query.trim();
    const turnId = crypto.randomUUID();
    const recentTurns = turns
      .filter((turn) => turn.mode !== "quick" && turn.answer.trim())
      .slice(-MAX_ANSWER_CONTEXT_TURNS);
    const retrievalContext = recentTurns
      .slice(-MAX_RETRIEVAL_CONTEXT_TURNS)
      .flatMap((turn) => [
        `Previous question: ${turn.question}`,
        `Previous answer: ${turn.answer.slice(0, 600)}`,
      ]);
    const retrievalQuery = retrievalContext.length
      ? `${retrievalContext.join("\n")}\nCurrent question: ${question}`
      : question;

    setBusy(true);
    setPendingTurnId(turnId);
    setError("");
    setStatus("");
    setQuery("");
    setTurns((current) => [
      ...current,
      { id: turnId, question, answer: "", sources: [], mode },
    ].slice(-MAX_CONVERSATION_TURNS));

    const updateTurn = (updates: Partial<ConversationTurn>) => {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId ? { ...turn, ...updates } : turn,
        ),
      );
    };

    try {
      setStatus(
        mode === "agent"
          ? "Interpreting question and retrieving sources…"
          : "Retrieving relevant passages…",
      );
      const searchStart = performance.now();
      console.log("[search] started");
      const embeddingStart = performance.now();

      let queryEmbedding = await embed(retrievalQuery, "RETRIEVAL_QUERY");
      console.log(
        `[search] embedding: ${elapsed(embeddingStart)}`,
      );
      const retrievalStart = performance.now();

      let retrievalResult =
        retrieve(
          document.chunks,
          queryEmbedding,
          retrievalQuery,
          document.bm25Index,
          8,
        );

      let candidates =
        retrievalResult.sources;
      console.log(
        `[search] retrieval: ${elapsed(retrievalStart)}`,
      );

      console.log(
        `[search] total so far: ${elapsed(searchStart)}`,
      );
      let retrievalConfidence =
        evaluateRetrievalConfidence(
          retrievalResult,
        );
      console.log(
        "[retrieval confidence]",
        retrievalConfidence,
      );
      if (mode === "agent") {
        let searchQuery = retrievalQuery;


        const MAX_RETRIEVAL_ATTEMPTS = 2;

        for (
          let attempt = 1;
          attempt <
          MAX_RETRIEVAL_ATTEMPTS;
          attempt++
        ) {

          if (
            shouldStopQueryRefinement(
              retrievalResult,
            )
          ) {
            setStatus(
              "✓ Retrieval evidence looks stable.",
            );

            break;
          }

          setStatus(
            "🔄 Refining search query…",
          );

          const seed =
            filterRelevantCandidates(
              candidates,
              3,
            );

          const refineStart =
            performance.now();

          const { query: refined } =
            await request(
              "/api/refine",
              {
                question: searchQuery,
                sources: seed,
              },
            );

          console.log(
            `[agent] refine ${attempt}: ${performance.now() -
            refineStart
            }ms`,
          );

          const nextQuery =
            refined?.trim();

          if (
            !nextQuery ||
            nextQuery.toLowerCase() ===
            searchQuery.toLowerCase()
          ) {
            break;
          }

          searchQuery =
            nextQuery;

          setStatus(
            `🔍 Searching again with refined query: "${searchQuery}"`,
          );

          const embeddingStart =
            performance.now();

          queryEmbedding =
            await embed(
              searchQuery,
              "RETRIEVAL_QUERY",
            );

          console.log(
            `[agent] embedding ${attempt}: ${performance.now() -
            embeddingStart
            }ms`,
          );

          const nextResult =
            retrieve(
              document.chunks,
              queryEmbedding,
              searchQuery,
              document.bm25Index,
              8,
            );

          console.log(
            `[agent] retrieval ${attempt}`,
            nextResult.signal,
          );
          const nextConfidence =
            evaluateRetrievalConfidence(
              nextResult,
            );

          console.log(
            "[agent] next retrieval confidence",
            nextConfidence,
          )

          const improved =
            retrievalImproved(
              retrievalResult,
              nextResult,
            );

          console.log(
            `[agent] retrieval improved: ${improved}`,
          );

          if (!improved) {

            break;
          }


          retrievalResult =
            nextResult;
          retrievalConfidence =
            nextConfidence
          candidates =
            nextResult.sources;

          setStatus(
            `🔍 Searching again - found ${candidates.length} candidate sections.`,
          );
          if (
            shouldStopQueryRefinement(
              retrievalResult,
            )
          ) {
            setStatus(
              "✓ Evidence search complete.",
            );

            break;
          }
        }
      }
      const found = filterRelevantCandidates(
        candidates,
        3
      );

      if (currentSearch !== searchId.current) return;

      if (!found.length) {
        const completedTurn: ConversationTurn = {
          id: turnId,
          question,
          answer: NO_INFORMATION_MESSAGE,
          sources: [],
          mode,
        };
        updateTurn({ answer: completedTurn.answer });
        await saveConversation(document.id, document.expiresAt, [
          ...turns,
          completedTurn,
        ]);
        setStatus("");
        return;
      }

      updateTurn({ sources: found });

      if (mode === "quick") {
        const completedTurn: ConversationTurn = {
          id: turnId,
          question,
          answer: `${found.length} relevant passage${found.length === 1 ? "" : "s"} found.`,
          sources: found,
          mode,
        };
        updateTurn({
          answer: completedTurn.answer,
        });
        await saveConversation(document.id, document.expiresAt, [
          ...turns,
          completedTurn,
        ]);
        setStatus("");
        return;
      }

      setStatus(
        mode === "summary"
          ? "Generating a grounded summary…"
          : "Generating a grounded answer…",
      );
      const answerStart = performance.now();

      const response = await fetch("/api/answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          sources: found,
          mode,
          conversationHistory: recentTurns.map(({ question, answer }) => ({
            question,
            answer,
          })),
          longTermMemories: longTermMemories.map((memory) => memory.text),
        }),
      });
      console.log(
        `[search] answer request: ${elapsed(answerStart)}`,
      )
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
              updateTurn({ answer: output });
            }
          } catch {
            /* malformed stream chunk */
          }
        }
      }

      if (currentSearch === searchId.current) {
        const completedTurn: ConversationTurn = {
          id: turnId,
          question,
          answer: output,
          sources: found,
          mode,
        };
        await saveConversation(document.id, document.expiresAt, [
          ...turns,
          completedTurn,
        ]);
        setStatus("");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Search failed";
      setError(message);
      updateTurn({ answer: "I couldn't complete that response." });
      setStatus("");
    } finally {
      setBusy(false);
      setPendingTurnId(null);
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <p className="eyebrow">DOCUMENT-GROUNDED AI</p>
        <h1>Ask your documents.</h1>
        <p className="muted">Answers stay tied to the active document and its sources.</p>
      </header>

      <section className="upload-bar" aria-label="Active document">
        <div className="document-info">
          <span className="upload-label">ACTIVE DOCUMENT</span>
          <strong>{document?.filename || "No document uploaded"}</strong>
          {document && (
            <span className="expiry">
              Expires {new Date(document.expiresAt).toLocaleString()}
            </span>
          )}
        </div>
        <label className="button upload-button">
          {document ? "Replace document" : "Upload document"}
          <input
            ref={input}
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            hidden
            onChange={(event) => upload(event.target.files?.[0])}
          />
        </label>
      </section>

      <MemoryPanel
        memories={longTermMemories}
        onAdd={async (text) => {
          setLongTermMemories(await addLongTermMemory(text));
        }}
        onDelete={async (id) => {
          setLongTermMemories(await deleteLongTermMemory(id));
        }}
      />

      <ConversationPanel
        turns={turns}
        pendingTurnId={pendingTurnId}
        status={status}
        error={error}
        openEvidence={openEvidence}
        busy={busy}
        documentName={document?.filename}
        onNewConversation={startNewConversation}
        onCitationClick={(turnId) =>
          setOpenEvidence((current) => ({ ...current, [turnId]: true }))
        }
        onEvidenceToggle={(turnId, open) =>
          setOpenEvidence((current) => ({ ...current, [turnId]: open }))
        }
      />

      <QuestionComposer
        query={query}
        mode={mode}
        documentName={document?.filename}
        busy={busy}
        onQueryChange={setQuery}
        onModeChange={setMode}
        onSubmit={() => search(mode)}
      />

      {document && (
        <button className="remove-document" onClick={removeDocument}>
          Remove active document
        </button>
      )}
    </main>
  );
}