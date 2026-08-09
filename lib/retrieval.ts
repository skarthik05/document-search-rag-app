import { sort } from "next/dist/build/webpack/loaders/css-loader/src/utils";
import type { Chunk, RetrievedSource, ScoredChunk } from "./types";

/** Reciprocal Rank Fusion constant. */
const RRF_K = 60;

const DENSE_CANDIDATES = 20;
const SPARSE_CANDIDATES = 20;

/** How far below the top fused score a passage may fall. */
const RELATIVE_SCORE_GAP = 1 / (RRF_K + 3);

export const NO_INFORMATION_MESSAGE =
  "The uploaded document does not contain enough information to answer this question.";

export function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let am = 0;
  let bm = 0;

  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    am += a[i] * a[i];
    bm += b[i] * b[i];
  }

  return dot / (Math.sqrt(am) * Math.sqrt(bm) || 1);
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]{2,}/g) || [])];
}

function termFrequency(term: string, text: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return (text.match(new RegExp(`\\b${escaped}\\b`, "gi")) || []).length;
}

export type BM25Index = {
  documentCount: number;
  averageDocumentLength: number;
  documentFrequency: Map<string, number>;
};

export function buildBM25Index(chunks: Chunk[]): BM25Index {
  if (!chunks.length) {
    return {
      documentCount: 0,
      averageDocumentLength: 0,
      documentFrequency: new Map(),
    };
  }

  const documentFrequency = new Map<string, number>();

  let totalLength = 0;

  for (const chunk of chunks) {
    totalLength += chunk.text.length;

    const uniqueTerms = tokenize(chunk.text);

    for (const term of uniqueTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  return {
    documentCount: chunks.length,
    averageDocumentLength: totalLength / chunks.length,
    documentFrequency,
  };
}

export function bm25Score(
  query: string,
  text: string,
  index: BM25Index,
): number {
  const terms = tokenize(query);

  if (
    !terms.length ||
    index.documentCount === 0 ||
    index.averageDocumentLength === 0
  ) {
    return 0;
  }

  const k1 = 1.2;
  const b = 0.75;

  const docLength = text.length;

  const lengthNorm = 1 - b + (b * docLength) / index.averageDocumentLength;

  let score = 0;

  for (const term of terms) {
    const df = index.documentFrequency.get(term) || 0;

    if (df === 0) {
      continue;
    }

    const idf = Math.log((index.documentCount - df + 0.5) / (df + 0.5) + 1);

    const tf = termFrequency(term, text);

    if (tf === 0) {
      continue;
    }

    score += idf * ((tf * (k1 + 1)) / (tf + k1 * lengthNorm));
  }

  return score;
}

function topK(scored: ScoredChunk[], k: number): ScoredChunk[] {
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Reciprocal Rank Fusion — merges dense and sparse ranked lists.
 */
function reciprocalRankFusion(
  denseOrder: string[],
  sparseOrder: string[],
): Map<string, number> {
  const fused = new Map<string, number>();

  for (const [rank, id] of denseOrder.entries()) {
    fused.set(id, (fused.get(id) || 0) + 1 / (RRF_K + rank + 1));
  }

  for (const [rank, id] of sparseOrder.entries()) {
    fused.set(id, (fused.get(id) || 0) + 1 / (RRF_K + rank + 1));
  }

  return fused;
}

export function queryMatchesCorpusIndex(
  query: string,
  chunks: Chunk[],
): boolean {
  const terms = tokenize(query);

  if (!terms.length || !chunks.length) {
    return false;
  }

  return chunks.some((chunk) => {
    const chunkTerms = new Set(tokenize(chunk.text));

    return terms.some((term) => chunkTerms.has(term));
  });
}

export function retrieve(
  chunks: Chunk[],
  queryEmbedding: number[],
  queryText: string,
  limit = 8,
): RetrievedSource[] {
  if (!chunks.length) {
    return [];
  }

  const bm25Index = buildBM25Index(chunks);

  const denseScored: ScoredChunk[] = chunks.map((chunk) => ({
    chunk,
    score: cosineSimilarity(chunk.embedding, queryEmbedding),
  }));

  const denseTop = topK(denseScored, Math.min(DENSE_CANDIDATES, chunks.length));

  const sparseScored: ScoredChunk[] = chunks.map((chunk) => ({
    chunk,
    score: bm25Score(queryText, chunk.text, bm25Index),
  }));

  const sparseTop = topK(
    sparseScored,
    Math.min(SPARSE_CANDIDATES, chunks.length),
  );

  const fused = reciprocalRankFusion(
    denseTop.map(({ chunk }) => chunk.id),
    sparseTop.map(({ chunk }) => chunk.id),
  );

  const candidateIds = new Set(fused.keys());

  const denseScores = new Map(
    denseScored.map(({ chunk, score }) => [chunk.id, score]),
  );

  return chunks
    .filter((chunk) => candidateIds.has(chunk.id))
    .map((chunk) => ({
      ...chunk,
      score: fused.get(chunk.id) || 0,

      denseScore: denseScores.get(chunk.id) || 0,

      sourceId: "",
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function filterRelevantCandidates(
  candidates: RetrievedSource[],
  _query?: string,
  _allChunks?: Chunk[],
  limit = 5,
): RetrievedSource[] {
  if (!candidates.length) {
    return [];
  }

  const topScore = candidates[0].score;

  const cutoff = topScore - RELATIVE_SCORE_GAP;

  return candidates
    .filter((candidate) => candidate.score >= cutoff)
    .slice(0, limit)
    .map((source, index) => ({
      ...source,
      sourceId: `Source ${index + 1}`,
    }))
    .sort((a, b) =>
      a.score === b.score ? b.denseScore - a.denseScore : b.score - a.score,
    );
}

export function mergeRetrievedSources(
  ...groups: RetrievedSource[][]
): RetrievedSource[] {
  const byId = new Map<string, RetrievedSource>();

  for (const group of groups) {
    for (const source of group) {
      const existing = byId.get(source.id);

      if (!existing || source.score > existing.score) {
        byId.set(source.id, source);
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.score - a.score);
}

export function labelSources(sources: RetrievedSource[]): RetrievedSource[] {
  return sources.map((source, index) => ({
    ...source,
    sourceId: `Source ${index + 1}`,
  }));
}
