# 00 — Initial MVP

## Why this version exists

The first version of the project was designed to make the complete RAG flow understandable without introducing a vector database, retrieval framework, or agent framework.

The goal was to build the pieces ourselves:

```text
Document
  ↓
Extract text
  ↓
Chunk
  ↓
Embed chunks
  ↓
Retrieve
  ↓
Give retrieved context to an LLM
```

The MVP was deliberately small: one active document, a limited number of passages, and local browser storage.

## Initial requirements

The application needed three search experiences.

### 1. Quick Search

The user asks a question and gets the relevant passages.

Important constraint:

> Quick Search does not use an LLM to generate the answer.

This makes it useful for inspecting retrieval independently.

### 2. Search & Summarize

The system retrieves relevant passages and then uses an LLM to summarize them.

```text
Question
  ↓
Retrieval
  ↓
Relevant passages
  ↓
LLM
  ↓
Summary
```

### 3. Agent Search

The system should be able to try again when the initial search does not appear sufficient.

The first implementation uses query refinement:

```text
Question
  ↓
Retrieve
  ↓
Ask LLM to refine query
  ↓
Retrieve again
```

The current implementation allows two refinement rounds.

## Ingestion

The application accepts:

- `.txt`
- text-based `.pdf`

Text extraction is followed by chunking.

The current chunking configuration is:

```text
Chunk size: 900 characters
Overlap:    180 characters
```

For PDFs, page numbers are retained with the resulting chunks.

Scanned PDFs are intentionally rejected because OCR is not part of this MVP.

## Embeddings

Every chunk receives an embedding during document ingestion.

At search time, the user question is embedded separately as a retrieval query.

The provider layer supports:

- Gemini
- OpenAI

The provider is selected through `AI_PROVIDER`.

## Local storage

The active document is stored in IndexedDB.

The stored object contains:

```text
id
filename
createdAt
expiresAt
chunks[]
bm25Index
```

The active document expires after 24 hours.

This keeps the MVP simple and avoids introducing a backend document database.

## First retrieval approach

The retrieval system combines two ideas:

### Dense retrieval

Each chunk has an embedding.

The query embedding is compared against chunk embeddings using cosine similarity.

```text
query embedding
      ↓
cosine similarity
      ↓
similar chunks
```

### Sparse retrieval

BM25 provides lexical matching.

This is useful when the user uses an exact word, identifier, name, or phrase that semantic similarity may not rank highly enough.

The project therefore treats dense and sparse retrieval as complementary rather than choosing only one.

## LLM grounding

The LLM receives the question plus retrieved source passages.

The prompt explicitly instructs the model to:

- use only the provided sources;
- avoid outside knowledge;
- cite factual claims with source labels;
- return a fixed no-information message when the evidence is insufficient.

This establishes the first grounding boundary of the MVP.

## Source citations

Retrieved passages are labelled:

```text
[Source 1]
[Source 2]
[Source 3]
```

The generated answer can reference those labels.

The UI turns the labels into links to the corresponding retrieved passage.

## What the initial MVP deliberately does not have

At this stage there is no:

- vector database;
- reranker;
- sophisticated query expansion;
- OCR;
- multi-document retrieval;
- long-term document store;
- evaluation dataset;
- tracing/observability layer;
- adaptive agent stopping;s

The point is to understand the fundamentals first.

## Baseline pipeline

```text
UPLOAD

file
 ↓
extract text
 ↓
chunk
 ↓
embed each chunk
 ↓
build BM25 index
 ↓
store locally


SEARCH

question
 ↓
embed question
 ↓
retrieve
 ↓
filter
 ↓
quick result
       OR
LLM evidence + answer
```

This version is the baseline against which later improvements are measured.
