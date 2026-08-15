export type Chunk = {
  id: string;
  text: string;
  page?: number;
  embedding: number[];
  documentId?: string;
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
  sparseScore: number;
  sourceId: string;
};
export type SearchMode = "quick" | "summary" | "agent";

export type ScoredChunk = {
  chunk: Chunk;
  score: number;
};

export type RetrievalSignal = {
  topDenseScore: number;
  secondDenseScore: number;
  denseGap: number;

  topSparseScore: number;
  secondSparseScore: number;
  sparseGap: number;

  topFusedScore: number;

  candidateCount: number;

  /**
   * Whether dense and sparse retrieval agree on the
   * highest-ranked candidate.
   *
   * This is a signal, NOT proof that the answer exists.
   */
  topRankAgreement: boolean;
};

export type RetrievalResult = {
  sources: RetrievedSource[];
  signal: RetrievalSignal;
};
