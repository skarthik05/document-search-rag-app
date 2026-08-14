# 01 - Retrieval Performance: Precomputation, Indexing, and Top-K

## Why this improvement was needed

The initial MVP retrieval worked, but the implementation performed unnecessary repeated work.

The original retrieval path effectively did:

```text
Question
   ↓
Dense scoring + full sort
   ↓
BM25 scoring + full sort
   ↓
RRF
   ↓
Final results
```

The problem was not that cosine similarity, BM25, or RRF were the wrong techniques.

The problem was **when and how often the calculations were performed**.

The first engineering improvement therefore focused on making the existing retrieval algorithm more efficient without replacing the technology.

---

## Improvement 1 - Pre-calculate dense scores

### Before

The original dense ranking calculated cosine similarity inside the `sort()` comparator.

Conceptually:

```text
sort chunks by:

cosineSimilarity(chunkA, query)
vs
cosineSimilarity(chunkB, query)
```

Because a sort comparator can run many times, the same cosine similarity could be calculated repeatedly for the same chunk.

The score was also calculated again later when constructing the final `RetrievedSource`.

### After

The implementation now calculates the score once per chunk:

```text
chunk
  ↓
cosineSimilarity(chunk, query)
  ↓
{ chunk, score }
```

Then the scored results are sorted.

```text
chunks
  ↓
score each chunk once
  ↓
sort scored chunks
  ↓
top K
```

### Why this is better

The query-specific dense score is now calculated once instead of being repeatedly recalculated during sorting.

The result is also easier to reason about because the score is an explicit piece of data:

```ts
{
  chunk,
  score
}
```

---

## Improvement 2 - Build the BM25 index upfront

### Before

The original BM25 implementation calculated corpus statistics while handling each search query.

For every BM25 score, it could calculate:

- document frequency;
- average document length.

Document frequency itself required scanning the chunks.

That meant query-time BM25 work included corpus-wide calculations that did not actually change between questions.

### The key insight

BM25 has two kinds of information:

```text
Corpus-level information
    ↓
document count
average document length
document frequency

Query/document-level information
    ↓
term frequency
query terms
```

The corpus-level information only needs to change when the document changes.

So it should be calculated during document indexing, not during every search.

### After

During upload:

```text
Document
  ↓
Chunks
  ↓
Build BM25 index
  ├── document count
  ├── average document length
  └── document frequency
  ↓
Persist with document
```

During search:

```text
Question
  ↓
BM25 score
  ↓
reuse existing BM25 index
```

The BM25 index is therefore built once and persisted with the active document.

---

## BM25 data model

The stored index contains:

```ts
type BM25Index = {
  documentCount: number;
  averageDocumentLength: number;
  documentFrequency: Record<string, number>;
};
```

This allows query-time BM25 scoring to look up the precomputed document frequency rather than scanning the complete corpus.

---

## Improvement 3 - Limit each retrieval strategy to Top-K

### Before

The original implementation created complete rankings for the active corpus:

```text
All chunks
   ↓
Dense full ranking
   ↓
Sparse full ranking
   ↓
RRF
```

But the application ultimately needed only a small number of candidates.

### After

Each retrieval strategy now produces a bounded candidate set before RRF:

```text
All chunks
   │
   ├── Dense scoring → Top 20
   │
   └── BM25 scoring  → Top 20
                         │
                         ▼
                       RRF
                         │
                         ▼
                    final Top N
```

The current configuration is:

```text
DENSE_CANDIDATES  = 20
SPARSE_CANDIDATES = 20
```

The final retrieval limit remains configurable.

### Why this matters

RRF does not need every chunk in the corpus.

It only needs the strongest candidates from each retrieval strategy.

This reduces the amount of ranking/fusion work and establishes a cleaner retrieval boundary:

```text
Retriever
  ↓
small candidate set
  ↓
fusion
  ↓
final evidence
```

---

## Improvement 4 - Reuse already calculated dense scores

After dense scoring, the implementation keeps the scores available for the candidate chunks.

This avoids recalculating:

```text
cosineSimilarity(chunk, query)
```

when constructing the final retrieved result.

The dense score is retained as:

```ts
denseScore
```

This is also useful later for debugging and evaluating retrieval behavior.

---

## Improvement 5 - Remove unnecessary corpus-wide work from candidate filtering

The earlier filtering logic performed another corpus-level lexical check after retrieval.

That created two problems:

1. It repeated work.
2. It could incorrectly reject a semantic match where the user's wording differed from the document.

For example:

```text
Document:
"Employees are entitled to twelve weeks of maternity leave."

Question:
"How much time can a new mother take off?"
```

There may be strong semantic similarity without strong lexical overlap.

The improved retrieval path therefore treats dense + BM25 + RRF as the candidate-generation stage rather than using lexical overlap as an absolute proof that evidence exists.

Evidence sufficiency is handled separately.

---

## New retrieval pipeline

The improved retrieval process is now:

```text
                         Question
                            │
                     Query embedding
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       Dense scoring                 BM25 scoring
       score once/chunk             use prebuilt index
              │                           │
              ▼                           ▼
          Top 20                       Top 20
              │                           │
              └─────────────┬─────────────┘
                            ▼
                           RRF
                            │
                            ▼
                     Fused candidates
                            │
                            ▼
                    Relative filtering
                            │
                            ▼
                     Final sources
```

---

## What changed conceptually

The important lesson from this improvement is:

> **The algorithm did not need to change. The execution strategy did.**

We kept:

```text
Cosine similarity
BM25
RRF
```

but changed when calculations happen and how much data flows between stages.

### Before

```text
query-time corpus calculations
+
repeated scoring
+
full rankings
+
full RRF
```

### After

```text
document-time BM25 preprocessing
+
one dense score per chunk
+
one BM25 score per chunk
+
Top-K candidate sets
+
RRF only over candidates
```

This is the first example of improving the MVP through engineering rather than replacing its technology.

---

## Tradeoffs

### What improved

- Less repeated computation.
- BM25 corpus statistics are reused across searches.
- Dense scores are calculated once.
- RRF operates on bounded candidate lists.
- Retrieval responsibilities became clearer.
- The implementation is easier to profile and test.

### What did not change

We intentionally did not introduce:

- a vector database;
- HNSW;
- FAISS;
- Elasticsearch;
- an external BM25 service;
- a reranker.

The active document is still small enough that direct scoring is appropriate for this learning MVP.

---

## Important limitation

The current `Top-K` implementation still sorts the scored chunks and then takes the first K.

That means the implementation is not yet using a specialized heap/top-K selection algorithm.

For the current MVP limit of 80 passages, this is completely reasonable.

If the project later moves to thousands or millions of chunks, this is one of the areas that can be revisited.

---

## Result

The retrieval engine now separates two kinds of work:

```text
Document-time work
─────────────────
Build embeddings
Build BM25 statistics
Persist search data


Query-time work
───────────────
Embed query
Calculate dense scores
Calculate BM25 scores
Take Top-K
RRF
Filter
```

That separation is the key architectural improvement introduced in this step.

It also gives us the foundation for the next optimization: measuring the actual latency of each stage before making further changes.
