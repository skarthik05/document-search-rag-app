import type { Chunk, RetrievedSource } from "./types";

/** RRF constant (Cormack, Clarke & Büttcher, 2009 — used in Elasticsearch, Pinecone, etc.) */
const RRF_K = 60;

/** How far below the top fused score a passage may fall and still be included. */
const RELATIVE_SCORE_GAP = 1 / (RRF_K + 3);

export const NO_INFORMATION_MESSAGE =
  "The uploaded document does not contain enough information to answer this question.";

export function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0,
    am = 0,
    bm = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    am += a[i] * a[i];
    bm += b[i] * b[i];
  }
  return dot / (Math.sqrt(am) * Math.sqrt(bm) || 1);
}

function tokenize(value: string) {
  return [...new Set(value.toLowerCase().match(/[a-z0-9]{2,}/g) || [])];
}

function containsWord(text: string, term: string) {
  return new RegExp(
    `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i",
  ).test(text);
}

function termFrequency(term: string, text: string) {
  return (text.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) || [])
    .length;
}

function termDocumentFrequency(term: string, chunks: Chunk[]) {
  return chunks.filter((chunk) => containsWord(chunk.text, term)).length;
}

/** Corpus BM25 — standard sparse retriever used in hybrid RAG pipelines. */
export function bm25Score(query: string, text: string, chunks: Chunk[]) {
  const terms = tokenize(query);
  if (!terms.length || !chunks.length) return 0;

  const avgLength =
    chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / chunks.length;
  const docLength = text.length;
  const k1 = 1.2;
  const b = 0.75;

  let score = 0;
  for (const term of terms) {
    const df = termDocumentFrequency(term, chunks);
    if (df === 0) continue;

    const idf = Math.log((chunks.length - df + 0.5) / (df + 0.5) + 1);
    const tf = termFrequency(term, text);
    const lengthNorm = 1 - b + (b * docLength) / avgLength;
    score += idf * ((tf * (k1 + 1)) / (tf + k1 * lengthNorm));
  }

  return score;
}

/** Reciprocal Rank Fusion — standard way to merge dense and sparse ranked lists. */
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

/** True when at least one query term is present in the corpus index (BM25 > 0 somewhere). */
export function queryMatchesCorpusIndex(query: string, chunks: Chunk[]) {
  if (!tokenize(query).length || !chunks.length) return false;
  return chunks.some((chunk) => bm25Score(query, chunk.text, chunks) > 0);
}

export function retrieve(
  chunks: Chunk[],
  queryEmbedding: number[],
  queryText: string,
  limit = 8,
): RetrievedSource[] {
  const denseRanked = [...chunks].sort(
    (a, b) =>
      cosineSimilarity(b.embedding, queryEmbedding) -
      cosineSimilarity(a.embedding, queryEmbedding),
  );
  const sparseRanked = [...chunks].sort(
    (a, b) => bm25Score(queryText, b.text, chunks) - bm25Score(queryText, a.text, chunks),
  );

  const fused = reciprocalRankFusion(
    denseRanked.map((chunk) => chunk.id),
    sparseRanked.map((chunk) => chunk.id),
  );

  return chunks
    .map((chunk) => ({
      ...chunk,
      score: fused.get(chunk.id) || 0,
      denseScore: cosineSimilarity(chunk.embedding, queryEmbedding),
      sourceId: "",
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function filterRelevantCandidates(
  candidates: RetrievedSource[],
  query: string,
  allChunks: Chunk[],
  limit = 5,
): RetrievedSource[] {
  if (!candidates.length || !queryMatchesCorpusIndex(query, allChunks)) {
    return [];
  }

  const topScore = candidates[0].score;
  const cutoff = topScore - RELATIVE_SCORE_GAP;

  return candidates
    .filter((candidate) => candidate.score >= cutoff)
    .slice(0, limit)
    .map((source, index) => ({ ...source, sourceId: `Source ${index + 1}` }));
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
