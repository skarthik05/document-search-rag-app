import type {
  BM25Index,
  Chunk,
  RetrievalResult,
  RetrievedSource,
  ScoredChunk,
} from "./types";

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

export function buildBM25Index(chunks: Chunk[]): BM25Index {
  if (!chunks.length) {
    return {
      documentCount: 0,
      averageDocumentLength: 0,
      documentFrequency: {},
    };
  }

  const documentFrequency: Record<string, number> = {};

  let totalLength = 0;

  for (const chunk of chunks) {
    totalLength += chunk.text.length;

    const uniqueTerms = tokenize(chunk.text);

    for (const term of uniqueTerms) {
      documentFrequency[term] = (documentFrequency[term] || 0) + 1;
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
    const df = index.documentFrequency[term] || 0;

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
 * Reciprocal Rank Fusion - merges dense and sparse ranked lists.
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
  bm25Index: BM25Index,
  limit = 8,
): RetrievalResult {
  if (!chunks.length || !bm25Index || !bm25Index.documentFrequency) {
    return {
      sources: [],
      signal: {
        topDenseScore: 0,
        secondDenseScore: 0,
        denseGap: 0,

        topSparseScore: 0,
        secondSparseScore: 0,
        sparseGap: 0,

        topFusedScore: 0,
        candidateCount: 0,

        topRankAgreement: false,
      },
    };
  }

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
  const sparseScores = new Map(
    sparseTop.map(({ chunk, score }) => [chunk.id, score]),
  );
  console.log("[retrieval]", {
    denseTopScore: denseTop[0]?.score,
    denseSecondScore: denseTop[1]?.score,

    sparseTopScore: sparseTop[0]?.score,
    sparseSecondScore: sparseTop[1]?.score,

    fusedTopScore: fused.get(denseTop[0]?.chunk.id),

    candidateCount: candidateIds.size,
  });
  const denseGap = (denseTop[0]?.score ?? 0) - (denseTop[1]?.score ?? 0);

  const sparseGap = (sparseTop[0]?.score ?? 0) - (sparseTop[1]?.score ?? 0);
  console.log({ denseGap, sparseGap });

  const sources = chunks
    .filter((chunk) => candidateIds.has(chunk.id))
    .map((chunk) => ({
      ...chunk,

      score: fused.get(chunk.id) || 0,

      denseScore: denseScores.get(chunk.id) || 0,

      sparseScore: sparseScores.get(chunk.id) || 0,

      sourceId: "",
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const topDense = denseTop[0]?.score || 0;

  const secondDense = denseTop[1]?.score || 0;

  const topSparse = sparseTop[0]?.score || 0;

  const secondSparse = sparseTop[1]?.score || 0;

  const topDenseId = denseTop[0]?.chunk.id;

  const topSparseId = sparseTop[0]?.chunk.id;

  const signal = {
    topDenseScore: topDense,
    secondDenseScore: secondDense,

    denseGap: topDense - secondDense,

    topSparseScore: topSparse,
    secondSparseScore: secondSparse,

    sparseGap: topSparse - secondSparse,

    topFusedScore: sources[0]?.score || 0,

    candidateCount: candidateIds.size,

    topRankAgreement: Boolean(
      topDenseId && topSparseId && topDenseId === topSparseId,
    ),
  };

  console.log("[retrieval signal]", signal);

  return {
    sources,
    signal,
  };
}

export function filterRelevantCandidates(
  candidates: RetrievedSource[],
  limit = 5,
): RetrievedSource[] {
  if (!candidates.length) {
    return [];
  }

  const topScore = candidates[0].score;

  const cutoff = topScore - RELATIVE_SCORE_GAP;

  return candidates
    .filter((candidate) => candidate.score >= cutoff)
    .sort((a, b) =>
      a.score === b.score ? b.denseScore - a.denseScore : b.score - a.score,
    )
    .slice(0, limit)
    .map((source, index) => ({
      ...source,
      sourceId: `Source ${index + 1}`,
    }));
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
function sourceIdSet(sources: RetrievedSource[]): Set<string> {
  return new Set(sources.map((source) => source.id));
}

function overlapRatio(a: RetrievedSource[], b: RetrievedSource[]): number {
  if (!a.length || !b.length) {
    return 0;
  }

  const aIds = sourceIdSet(a);

  const intersection = b.filter((source) => aIds.has(source.id)).length;

  const denominator = Math.max(a.length, b.length);

  return intersection / denominator;
}
/**
 * Determines whether the second retrieval actually
 * produced meaningfully different evidence.
 *
 * This is intentionally based on relative change rather
 * than an absolute cosine/BM25 threshold.
 */
export function retrievalImproved(
  previous: RetrievalResult,
  next: RetrievalResult,
): boolean {
  const previousTop = previous.signal.topFusedScore;

  const nextTop = next.signal.topFusedScore;

  /*
   * New top result is useful evidence of improvement.
   */
  const previousTopId = previous.sources[0]?.id;

  const nextTopId = next.sources[0]?.id;

  if (nextTopId && nextTopId !== previousTopId && nextTop > previousTop) {
    return true;
  }

  /*
   * Same top result, but a meaningful score improvement.
   *
   * We deliberately use a relative comparison instead
   * of hardcoding a model-specific score threshold.
   */
  if (previousTop > 0 && nextTop > previousTop * 1.05) {
    return true;
  }

  /*
   * Significant evidence-set change.
   */
  const overlap = overlapRatio(
    previous.sources.slice(0, 5),
    next.sources.slice(0, 5),
  );

  if (overlap < 0.6 && nextTop >= previousTop) {
    return true;
  }

  return false;
}

/**
 * Cheap deterministic decision used by Agent Search.
 *
 * This does NOT mean "the question is answered."
 * It only answers:
 *
 * "Do we have enough retrieval signal to stop
 * spending time on more query reformulation?"
 */
export function shouldStopAgentSearch(result: RetrievalResult): boolean {
  const sources = result.sources;
  const { candidateCount, topRankAgreement } = result.signal;

  if (!sources.length) {
    return false;
  }

  /*
   * Dense + sparse agree on the same top chunk.
   *
   * This is a strong retrieval stability signal.
   */
  if (topRankAgreement && candidateCount >= 2) {
    return true;
  }

  /*
   * Multiple stable candidates also give us a reason
   * not to immediately spend another expensive LLM call.
   *
   * This is intentionally conservative.
   */
  if (sources.length >= 3 && candidateCount >= 3) {
    return true;
  }

  return false;
}
