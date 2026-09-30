import type { RetrievedSource, SearchMode } from "./types";

export type ConversationTurn = {
  id: string;
  question: string;
  answer: string;
  sources: RetrievedSource[];
  mode: SearchMode;
};

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