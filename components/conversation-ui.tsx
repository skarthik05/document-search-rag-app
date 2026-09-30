import type {
  ConversationPanelProps,
  QuestionComposerProps,
} from "../lib/conversation-types";

function renderAnswer(answer: string, turnId: string, onCitationClick: () => void) {
  return answer.split(/(\[Source \d+\])/g).map((part, index) => {
    const sourceNumber = part.match(/^\[Source (\d+)\]$/)?.[1];
    if (!sourceNumber) return part;
    return (
      <a
        key={index}
        href={`#${turnId}-source-${sourceNumber}`}
        className="citation"
        onClick={onCitationClick}
      >
        {part}
      </a>
    );
  });
}

export function ConversationPanel({
  turns,
  pendingTurnId,
  status,
  error,
  openEvidence,
  busy,
  documentName,
  onNewConversation,
  onCitationClick,
  onEvidenceToggle,
}: ConversationPanelProps) {
  return (
    <section className="conversation" aria-label="Conversation">
      <div className="conversation-heading">
        <div>
          <span className="section-kicker">DOCUMENT Q&A</span>
          <h2>Conversation</h2>
        </div>
        <button
          className="quiet-button"
          disabled={!turns.length || busy}
          onClick={onNewConversation}
        >
          New conversation
        </button>
      </div>

      {!turns.length ? (
        <div className="empty-conversation">
          <div className="empty-mark" aria-hidden="true">Q</div>
          <p>{documentName ? "What would you like to know?" : "Upload a document to start asking questions."}</p>
        </div>
      ) : (
        <div className="transcript">
          {turns.map((turn) => (
            <article className="turn" key={turn.id}>
              <div className="question-row">
                <span className="question-mark" aria-hidden="true">You</span>
                <p>{turn.question}</p>
              </div>
              <div className="response-row">
                <span className="assistant-mark" aria-hidden="true">🤖</span>
                <div className="response-content">
                  <div className="response-heading">
                    <strong>{turn.mode === "summary" ? "Summary" : turn.mode === "quick" ? "Sources" : "Answer"}</strong>
                    {turn.answer && (
                      <button
                        className="copy-button"
                        onClick={() => navigator.clipboard.writeText(turn.answer)}
                      >
                        Copy
                      </button>
                    )}
                  </div>
                  <p className={turn.answer ? "answer-text" : "pending-answer"}>
                    {turn.answer
                      ? renderAnswer(turn.answer, turn.id, () => onCitationClick(turn.id))
                      : pendingTurnId === turn.id
                        ? status || "Working…"
                        : "No response."}
                  </p>
                  {turn.sources.length > 0 && (
                    <details
                      className="evidence"
                      open={Boolean(openEvidence[turn.id])}
                      onToggle={(event) => onEvidenceToggle(turn.id, event.currentTarget.open)}
                    >
                      <summary>
                        {turn.sources.length} retrieved passage{turn.sources.length === 1 ? "" : "s"}
                      </summary>
                      <ol className="evidence-list">
                        {turn.sources.map((source, index) => {
                          const sourceNumber = source.sourceId.match(/\d+/)?.[0] || String(index + 1);
                          return (
                            <li key={source.id} id={`${turn.id}-source-${sourceNumber}`}>
                              <div className="evidence-meta">
                                <strong>[{source.sourceId}]</strong>
                                <span>{documentName}{source.page ? ` · Page ${source.page}` : ""}</span>
                                <span>{(source.denseScore * 100).toFixed(1)}% semantic match</span>
                              </div>
                              <p>{source.text}</p>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {(error || (status && !pendingTurnId)) && (
        <p className={error ? "notice error" : "notice"} role="status">
          {error || status}
        </p>
      )}
    </section>
  );
}

export function QuestionComposer({
  query,
  mode,
  documentName,
  busy,
  onQueryChange,
  onModeChange,
  onSubmit,
}: QuestionComposerProps) {
  return (
    <section className="composer" aria-label="Ask a question">
      <textarea
        rows={2}
        value={query}
        disabled={!documentName || busy}
        aria-label="Your question"
        placeholder={documentName ? "Ask a follow-up about this document…" : "Upload a document to start a conversation"}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      <div className="composer-controls">
        <div className="mode-selector" role="group" aria-label="Response mode">
          <button className={mode === "agent" ? "mode-option selected" : "mode-option"} aria-pressed={mode === "agent"} onClick={() => onModeChange("agent")}>Answer</button>
          <button className={mode === "summary" ? "mode-option selected" : "mode-option"} aria-pressed={mode === "summary"} onClick={() => onModeChange("summary")}>Summary</button>
          <button className={mode === "quick" ? "mode-option selected" : "mode-option"} aria-pressed={mode === "quick"} onClick={() => onModeChange("quick")}>Find sources</button>
        </div>
        <button className="send-button" disabled={!documentName || !query.trim() || busy} onClick={onSubmit}>
          {busy ? "Working…" : "Send"}
        </button>
      </div>
      <div className="composer-footer">
        <span>{documentName || "No active document"}</span>
        <span>Enter to send · Shift+Enter for a new line</span>
      </div>
    </section>
  );
}