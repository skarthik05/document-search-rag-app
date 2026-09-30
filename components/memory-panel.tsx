"use client";

import { useState, type FormEvent } from "react";
import type { MemoryPanelProps } from "../lib/conversation-types";

export function MemoryPanel({ memories, onAdd, onDelete }: MemoryPanelProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;

    setBusy(true);
    try {
      await onAdd(text);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="memory-panel">
      <summary>Saved memory <span>{memories.length}</span></summary>
      <p className="memory-description">
        Stored on this device until deleted. Saved entries are sent to the AI provider with questions; the 30 most recent may be used for personalization or questions about you.
      </p>
      <form className="memory-form" onSubmit={submit}>
        <label htmlFor="memory-entry">What should I remember?</label>
        <div className="memory-input-row">
          <input
            id="memory-entry"
            value={draft}
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="For example: I prefer concise answers"
          />
          <button type="submit" disabled={!draft.trim() || busy}>
            Save
          </button>
        </div>
      </form>
      {memories.length > 0 && (
        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              <span>{memory.text}</span>
              <button
                type="button"
                aria-label={`Delete saved memory: ${memory.text}`}
                onClick={() => void onDelete(memory.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}