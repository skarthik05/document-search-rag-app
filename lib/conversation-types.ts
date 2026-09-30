import type { RetrievedSource, SearchMode } from "./types";

export type ConversationSource = Pick<
  RetrievedSource,
  "id" | "text" | "page" | "score" | "denseScore" | "sparseScore" | "sourceId"
>;

export type ConversationTurn = {
  id: string;
  question: string;
  answer: string;
  sources: ConversationSource[];
  mode: SearchMode;
};

export type LongTermMemory = {
  id: string;
  text: string;
  createdAt: number;
};

export type ConversationContextTurn = Pick<ConversationTurn, "question" | "answer">;

export type ConversationPanelProps = {
  turns: ConversationTurn[];
  pendingTurnId: string | null;
  status: string;
  error: string;
  openEvidence: Record<string, boolean>;
  busy: boolean;
  documentName?: string;
  onNewConversation: () => void;
  onCitationClick: (turnId: string) => void;
  onEvidenceToggle: (turnId: string, open: boolean) => void;
};

export type QuestionComposerProps = {
  query: string;
  mode: SearchMode;
  documentName?: string;
  busy: boolean;
  onQueryChange: (query: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onSubmit: () => void;
};

export type MemoryPanelProps = {
  memories: LongTermMemory[];
  onAdd: (text: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};