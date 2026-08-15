# 03 - Agent Search: Adaptive Query Refinement and Retrieval Stability

## Why this improvement was needed

The MVP initially treated Agent Search as:

```text
Question
   ↓
Retrieve
   ↓
Refine query
   ↓
Retrieve again
   ↓
Refine again
   ↓
Retrieve again
   ↓
Verify evidence
   ↓
Generate answer
```

The problem was not the idea of query refinement itself.

The problem was that the agent had no real understanding of **when it should stop searching**.

The previous implementation effectively had a fixed search budget:

```ts
for (let round = 0; round < 2; round++) {
  refine();
  retrieve();
}
```

This meant the system could spend several seconds refining a query even when the first retrieval was already good enough.

The latency measurements made this visible.

For one Agent Search request, the system recorded approximately:

```text
Initial embedding       ~1.24s
Initial retrieval       ~1ms

Refinement #1           ~3.14s
Embedding #1            ~0.89s
Retrieval #1            ~3ms

Refinement #2           ~4.28s
Embedding #2            ~0.91s
Retrieval #2            ~3ms

Evidence verification   ~5.59s
Answer generation       ~7.47s
```

The important observation was:

> **Retrieval itself was extremely fast. The expensive part was repeatedly asking the model to refine the query and generating new embeddings.**

This led to the next engineering question:

> **How can the agent decide whether another search is actually worth the cost?**

---

## The key insight

Agent Search should not be:

```text
"Search twice because the code says so."
```

It should be:

```text
"Search again only when the current retrieval is uncertain."
```

This changes Agent Search from a fixed loop into an adaptive process.

---

# Improvement 1 - Separate retrieval results from retrieval evidence

### Before

The retrieval function returned only the retrieved sources:

```ts
RetrievedSource[]
```

Conceptually:

```text
retrieve()
    ↓
sources
```

This made it difficult for the agent to understand what happened during retrieval.

The agent could see the passages, but it did not directly know:

- how strong the top dense match was;
- how far the second dense result was from it;
- how strong the BM25 match was;
- how far the second sparse result was from it;
- whether dense and sparse retrieval agreed;
- how many candidates were produced.

### After

Retrieval now has a richer conceptual result:

```ts
type RetrievalResult = {
  sources: RetrievedSource[];

  signal: {
    topDenseScore: number;
    secondDenseScore: number;
    denseGap: number;

    topSparseScore: number;
    secondSparseScore: number;
    sparseGap: number;

    topFusedScore: number;
    candidateCount: number;

    topRankAgreement: boolean;
  };
};
```

The retrieval boundary therefore becomes:

```text
Question
   ↓
Retriever
   ↓
RetrievalResult
   ├── sources
   └── retrieval signal
```

The important architectural change is that retrieval now exposes enough information for the search orchestrator to make decisions.

---

# Improvement 2 - Measure retrieval stability

A single similarity score is not enough to determine whether another search is necessary.

For example:

```text
Dense:

Top       0.736
Second    0.734

Gap       0.001
```

This is essentially a tie.

But BM25 might show:

```text
BM25:

Top       1.197
Second    0.204

Gap       0.993
```

That tells us something different.

The system therefore looks at several signals together.

### Dense gap

```text
denseGap =
topDenseScore - secondDenseScore
```

This tells us how clearly the strongest semantic candidate separates from the next candidate.

### Sparse gap

```text
sparseGap =
topSparseScore - secondSparseScore
```

This provides the equivalent signal for lexical retrieval.

### Dense/sparse agreement

The system also checks whether both retrieval strategies selected the same top chunk.

```text
Dense top
    │
    └────────┐
             ├── same chunk → agreement
             │
BM25 top ────┘
```

Agreement between independent retrieval strategies is useful as a **retrieval stability signal**.

It does not mean that the answer is definitely present.

---

# Important distinction - Retrieval stability is not answerability

This is one of the most important concepts introduced in this step.

These are two different questions.

### Retrieval confidence

> Did the retrieval system find passages that look relevant?

### Answerability

> Do those passages actually contain enough information to answer the user's specific question?

They are not the same.

For example:

```text
Question:

How many weeks of maternity leave are available?
```

A retrieved passage might contain:

```text
Employees are eligible for maternity leave.
```

The passage is clearly related to the question.

However, it does not provide the number of weeks.

Therefore:

```text
Relevant passage
        ≠
Sufficient evidence
```

The adaptive search logic is responsible for deciding whether another retrieval attempt is worthwhile.

The evidence-verification stage remains responsible for deciding whether the retrieved passages actually support the answer.

This keeps the responsibilities separate.

---

# Improvement 3 - Replace fixed refinement with adaptive refinement

### Before

Agent Search effectively behaved like:

```text
Initial search
      ↓
Refine
      ↓
Search
      ↓
Refine
      ↓
Search
      ↓
Stop
```

The number of searches was determined by the loop.

### After

The intended flow becomes:

```text
Initial search
      ↓
Evaluate retrieval stability
      │
      ├── Stable → STOP
      │
      └── Uncertain
              ↓
           Refine query
              ↓
          Search again
              ↓
       Did retrieval improve?
          │           │
         Yes          No
          │           │
          ▼           ▼
        STOP         STOP
```

The important difference is:

> **The agent spends another LLM call only when the retrieval state gives us a reason to do so.**

---

# Improvement 4 - Introduce a retrieval improvement check

Query refinement itself is not automatically useful.

A refined query might:

- retrieve the same passages;
- produce almost the same ranking;
- produce weaker evidence;
- change wording without changing retrieval results.

Therefore, after refinement we compare the old and new retrieval results.

Conceptually:

```ts
retrievalImproved(previous, next);
```

The comparison can consider:

### 1. New top result

Did the refined query discover a better top result?

```text
Previous:

Source A
score = X

New:

Source B
score > X
```

That can be useful evidence of improvement.

### 2. Top-score improvement

If the same result remains at the top, did its retrieval score improve meaningfully?

```text
Previous: 0.0322
New:      0.0340
```

A tiny change should not automatically justify another expensive refinement.

### 3. Evidence-set change

Did the refined query discover substantially different candidates?

```text
Before:

A
B
C

After:

A
D
E
```

A meaningful change in the evidence set can justify treating the refined search as useful.

---

# Improvement 5 - Give Agent Search a bounded budget

Adaptive does not mean unlimited.

For the current MVP, Agent Search has a deliberately small retrieval budget.

The intended limit is:

```text
Maximum retrieval attempts = 2
```

Meaning:

```text
Attempt 1
Initial query

Attempt 2
One refined query, only if necessary
```

This is an important design decision.

The system is not being designed around:

```text
"Keep searching until the LLM feels satisfied."
```

Instead:

```text
"Use a small bounded search budget and stop early when further work
is unlikely to improve the evidence."
```

This prevents agentic behavior from becoming an uncontrolled latency multiplier.

---

# Improvement 6 - Keep multi-document support as a future extension

The current MVP has one active document:

```text
Document
   ↓
Chunks
   ↓
Retriever
```

The architecture should not assume that one document is a permanent limitation.

The important boundary is:

```text
                    Search request
                          ↓
                  Retrieval corpus
                          ↓
                       Retriever
                          ↓
                  RetrievalResult
```

Today:

```text
Retrieval corpus
      ↓
One active document
```

Later:

```text
Retrieval corpus
      ↓
Multiple documents
      ↓
Document selection / filtering
      ↓
Retriever
```

The retrieval and agent orchestration logic should remain unchanged.

This means adding multiple documents later should primarily require changes around **corpus management and document selection**, rather than rewriting the search agent.

---

# New Agent Search pipeline

The improved conceptual flow is:

```text
                         User question
                              │
                              ▼
                       Query embedding
                              │
                              ▼
                       Initial retrieval
                              │
                              ▼
                     RetrievalResult
                     ┌────────┴────────┐
                     │                 │
                  Sources            Signal
                                       │
                         ┌─────────────┴─────────────┐
                         │                           │
                     Stable                    Uncertain
                         │                           │
                         ▼                           ▼
                       STOP                    Refine query
                                                     │
                                                     ▼
                                             Query embedding
                                                     │
                                                     ▼
                                              Retrieval again
                                                     │
                                                     ▼
                                           Compare with previous
                                                     │
                                             ┌───────┴───────┐
                                             │               │
                                          Improved       Not improved
                                             │               │
                                             ▼               ▼
                                            STOP            STOP
```

After the search stage:

```text
                         Retrieved evidence
                                │
                                ▼
                       Evidence verification
                                │
                     ┌──────────┴──────────┐
                     │                     │
                 Sufficient            Insufficient
                     │                     │
                     ▼                     ▼
                Generate answer         Abstain
```

---

# The responsibility boundaries

This improvement also makes the system easier to reason about.

## Retriever

Responsible for:

```text
Dense retrieval
BM25 retrieval
RRF
Candidate generation
Retrieval signals
```

It answers:

> "What passages look relevant?"

---

## Search orchestrator

Responsible for:

```text
Initial search
Query refinement
Search budget
Comparing retrieval attempts
Stopping
```

It answers:

> "Is another search worth doing?"

---

## Evidence verifier

Responsible for:

```text
Checking retrieved passages against the question
Selecting supporting sources
Determining whether evidence is sufficient
```

It answers:

> "Do these passages actually support the answer?"

---

## Answer generator

Responsible for:

```text
Generating the final response
Using only verified sources
Adding source citations
```

It answers:

> "How should the supported information be presented?"

This separation prevents the entire pipeline from becoming one large "RAG function."

---

# Latency impact

The main improvement is not making cosine similarity or BM25 faster.

Those operations were already extremely fast.

The measurements showed:

```text
Embedding             ~1–3s
Retrieval              ~1–10ms
Query refinement       ~3–4s
Evidence verification  ~3–59s
Answer generation      ~3–7s
```

Therefore the adaptive agent focuses on eliminating **unnecessary expensive model calls**, rather than optimizing a retrieval operation that is already taking only milliseconds.

---

# Example from the measured Agent Search run

The system produced:

```text
Dense top score       0.7359
Dense second score    0.7345
Dense gap             0.0014

BM25 top score        1.1968
BM25 second score     0.2044
BM25 gap              0.9924

Candidate count       3
Top-rank agreement    true
```

Dense and sparse retrieval agreed on the top candidate.

Although the dense scores were very close, the sparse ranking had a clearer separation.

The retrieval therefore appeared stable enough that another query rewrite was unlikely to justify another expensive LLM call.

The agent stopped after the initial retrieval instead of performing additional refinement rounds.

This is the behavior we want:

```text
Good enough retrieval
        ↓
Stop searching
        ↓
Move to evidence verification
```

rather than:

```text
Good enough retrieval
        ↓
Refine anyway
        ↓
Pay another LLM latency cost
```

---

# What changed conceptually

The main lesson from this improvement is:

> **An agent should not be defined by how many times it calls a model. It should be defined by the decisions it makes about whether another action is necessary.**

The original implementation was:

```text
Fixed search attempts
+
LLM refinement
+
more retrieval
```

The improved design is:

```text
Retrieve
   ↓
Measure retrieval state
   ↓
Decide whether another search is useful
   ↓
Refine only when necessary
   ↓
Stop when additional search has diminishing value
```

This introduces an important concept into the MVP:

```text
Adaptive orchestration
```

The system is now beginning to distinguish between:

```text
retrieval
```

and:

```text
decision-making around retrieval
```

---

# What we intentionally did not change

This improvement does not replace the existing retrieval technology.

We continue to use:

```text
Embeddings
Cosine similarity
BM25
RRF
LLM query refinement
LLM evidence verification
LLM answer generation
```

We did not introduce:

- a vector database;
- an agent framework;
- a reranker;
- HNSW;
- a workflow engine;
- autonomous unlimited search;
- multi-agent orchestration.

The goal is to improve the engineering of the existing MVP before introducing additional infrastructure.

---

# Tradeoffs

## What improved

- Agent Search no longer needs to perform every possible refinement round.
- Query refinement becomes conditional.
- Retrieval results expose signals that can be used by the orchestrator.
- Retrieval stability and answerability are treated as separate concepts.
- Agent behavior becomes bounded and predictable.
- Expensive LLM calls can be avoided when additional searching is unlikely to help.
- The retrieval boundary remains reusable for future multi-document search.
- Latency becomes something the agent can actively manage.

## What did not change

The application still:

- uses one active document;
- stores the document locally;
- supports `.txt` and text-based PDF extraction;
- uses the existing embedding provider;
- uses BM25 + dense retrieval + RRF;
- uses LLM-based evidence verification;
- uses LLM generation for summaries and answers.

---

# Important limitation

The adaptive stopping decision is **not an answerability check**.

A stable retrieval result does not prove that the document contains enough information to answer the question.

For example:

```text
Question:
"What is the maternity leave duration?"

Retrieved passage:
"Maternity leave is available to eligible employees."
```

The retrieval may be highly relevant.

But the duration is missing.

Therefore:

```text
Retrieval stability
        ↓
does not mean
        ↓
Answerability
```

The evidence-verification stage remains necessary until we introduce a sufficiently reliable alternative.

This distinction is important because optimizing latency must not weaken the MVP's core requirement:

> **When the document does not contain enough information, the system should say so instead of inventing an answer.**

---

# Result

The Agent Search architecture now moves toward:

```text
Question
   ↓
Retrieve
   ↓
Measure retrieval state
   ↓
Is another search worthwhile?
   │
   ├── No ───────────────┐
   │                     │
   └── Yes               │
        ↓                │
    Refine query         │
        ↓                │
     Retrieve            │
        ↓                │
    Compare              │
        │                │
        └────────────────┘
                 ↓
          Evidence verification
                 ↓
        ┌────────┴────────┐
        │                 │
     Sufficient        Insufficient
        │                 │
        ▼                 ▼
     Generate           Abstain
        │
        ▼
      Answer
```

The important architectural principle introduced in this step is:

> **Search should be adaptive, bounded, and evidence-driven rather than a fixed sequence of LLM calls.**

This gives the MVP a foundation for more capable Agent Search later while keeping the current implementation simple.

It also keeps the future multi-document requirement isolated to the retrieval corpus layer instead of coupling it to the agent's search logic.
