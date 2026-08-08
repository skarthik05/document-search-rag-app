export type Chunk = { id: string; text: string; page?: number; embedding: number[] };
export type StoredDocument = { id: string; filename: string; createdAt: number; expiresAt: number; chunks: Chunk[] };
export type RetrievedSource = Chunk & {
  score: number;
  denseScore: number;
  sourceId: string;
};
export type SearchMode = "quick" | "summary" | "agent";
