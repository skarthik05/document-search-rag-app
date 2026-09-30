# Source Search

A small document-grounded AI search application built as an MVP to understand how modern RAG systems work from the ground up.

The goal is not to hide retrieval behind a vector database or framework. The important pieces are implemented explicitly so the retrieval pipeline can be understood, tested, and improved step by step.

## What the app does

1. Upload one `.txt` or text-based `.pdf` document.
2. Extract readable text.
3. Split the document into overlapping passages.
4. Generate an embedding for every passage.
5. Build a BM25 sparse-search index.
6. Store the document and search data locally in IndexedDB for 24 hours.
7. Search using both:
   - Dense retrieval with cosine similarity.
   - Sparse retrieval with BM25.
8. Combine the rankings using Reciprocal Rank Fusion (RRF).
9. Filter weak retrieval results.
10. Optionally verify whether the retrieved evidence is sufficient.
11. Generate a grounded response with source citations.
12. For Agent Search, iteratively refine the search query and retrieve again.
13. Keep bounded per-document conversation history and user-approved memories locally in the browser.

---

## Prerequisites

Before getting started, make sure you have:

- Node.js 20+
- pnpm
- Ollama with the configured models, or an API key for Gemini or OpenAI
- A modern browser with IndexedDB support

---

## Clone the repository

```bash
git clone https://github.com/skarthik05/document-search-rag-app
cd document-search-rag-app
```

---

## Install dependencies

```bash
pnpm install
```

---

## Configure environment variables

Create a `.env.local` file in the project root.

### Using Ollama (default)

Start Ollama and pull the models:

```bash
ollama pull nomic-embed-text
ollama pull llama3.2
```

The application defaults to Ollama at `http://localhost:11434` with these models:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OLLAMA_LLM_MODEL=llama3.2
```

These are also the built-in defaults, so `AI_PROVIDER` and the model variables can be omitted when using the default local Ollama setup.

### Using Gemini

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```

### Or using OpenAI

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
```

---

## Run the application

Start the development server:

```bash
pnpm run dev
```

Open the application in your browser:

```text
http://localhost:3000
```

---

## Build for production

Create a production build:

```bash
pnpm run build
```

Then start the production server:

```bash
pnpm run start
```

---

## How to use

1. Upload a `.txt` or text-based `.pdf` document.
2. Wait for the document to finish indexing.
3. Ask a question about the document.
4. Choose one of the available search modes.

## Search modes

### Quick Search

No LLM answer generation.

```text
Question
   ↓
Query embedding
   ↓
Dense retrieval ─────┐
                     ├── RRF
BM25 retrieval ──────┘
   ↓
Relevant-source filtering
   ↓
Show passages
```

The purpose is to answer:

> "Which parts of the document are relevant?"

### Search & Summarize

Uses retrieval followed by an evidence check and an LLM-generated summary.

```text
Question
   ↓
Hybrid retrieval
   ↓
Relevant-source filtering
   ↓
Evidence verification
   ↓
Grounded summary
```

### Agent Search

Allows the system to refine the search query when the initial retrieval may not be enough.

```text
Question
   ↓
Initial retrieval
   ↓
Refine query with LLM
   ↓
Embed refined query
   ↓
Retrieve again
   ↓
Merge evidence
   ↓
Evidence verification
   ↓
Grounded answer
```

The current MVP allows up to two refinement rounds.

## Architecture

```text
┌──────────────────────────────┐
│          Next.js UI          │
│  Upload / Search / Sources   │
└──────────────┬───────────────┘
               │
               ├───────────────┐
               │               │
               ▼               ▼
       Document pipeline    Search pipeline
               │               │
               ▼               ▼
        Extract + chunk     Query embedding
               │               │
               ▼               ▼
        Document embeddings  Dense retrieval
               │               │
               ▼               ├─────────────┐
            BM25 index          │             │
               │               ▼             ▼
               │             BM25           RRF
               │               └──────┬──────┘
               │                      ▼
               │                 Filtering
               │                      │
               └──────────────────────┤
                                      ▼
                              Evidence / LLM
                                      │
                                      ▼
                               Grounded answer
```

## Main technologies

- Next.js / React
- TypeScript
- IndexedDB via `idb`
- `pdfjs-dist` for text-based PDFs
- BM25 implemented in TypeScript
- Cosine similarity implemented in TypeScript
- Reciprocal Rank Fusion implemented in TypeScript
- Gemini or OpenAI for embeddings and LLM operations
- Server-Sent Events for streamed answers

## Current limits

This is intentionally an MVP.

- One active document at a time.
- Maximum 80 passages.
- `.txt` and text-based `.pdf` files.
- Scanned PDFs are not supported.
- Document data is retained locally for 24 hours.
- Retrieval is in-memory over the active document.
- No external vector database.
- No reranker model yet.
- Agent Search uses a small fixed refinement budget.

## Project structure

```text
app/
├── api/
│   ├── answer/
│   ├── embed/
│   ├── refine/
│   └── relevance/
└── ...

lib/
├── ai-provider.ts
├── app-db.ts
├── chunking.ts
├── conversation-types.ts
├── document-store.ts
├── extract-text.ts
├── memory-limits.ts
├── memory-store.ts
├── retrieval.ts
└── types.ts

components/
├── conversation-ui.tsx
├── document-search-app.tsx
└── memory-panel.tsx
```

## Development philosophy

This project is being built as a learning-oriented RAG MVP.

Each major improvement should answer three questions:

1. What problem did the previous version have?
2. What concept or technique did I introduce?
3. What changed in the system because of it?

The `docs/` directory is the engineering history of the project.

The documents are intentionally kept separate instead of turning the README into a long changelog.

## Project history

The `docs/` directory is the engineering history of the project. Each numbered document explains the problem, the concept introduced, and the resulting system change; diagrams are included when they clarify a flow or boundary. Keep this learning history in separate documents instead of expanding the README into a changelog.

- [00 - Initial MVP](./docs/00-initial-mvp.md)
- [01 - Retrieval performance](./docs/01-retrieval-performance.md)
- [02 - Agent search and adaptive query refinement](./docs/02-agent-search-adaptive-query-refinement.md)
- [03 - Retrieval confidence and adaptive evidence verification](./docs/03-retrieval-confidence-and-adaptive-evidence-verification.md)
- [05 - Conversation history and user memory](./docs/05-conversation-and-user-memory.md)
