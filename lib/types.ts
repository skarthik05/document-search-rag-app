export type Chunk = {
  id: string;
  text: string;
  page?: number;
  embedding: number[];
};
export type BM25Index = {
  documentCount: number;
  averageDocumentLength: number;
  documentFrequency: Record<string, number>;
};
export type StoredDocument = {
  id: string;
  filename: string;
  createdAt: number;
  expiresAt: number;
  chunks: Chunk[];
  bm25Index: BM25Index;
};
export type RetrievedSource = Chunk & {
  score: number;
  denseScore: number;
  sourceId: string;
};
export type SearchMode = "quick" | "summary" | "agent";

export type ScoredChunk = {
  chunk: Chunk;
  score: number;
};
