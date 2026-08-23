# 04 - Retrieval Confidence and Adaptive Evidence Verification

## Development philosophy

This project is being built as a learning-oriented RAG MVP.

Each major improvement should answer three questions:

1.  What problem did the previous version have?
2.  What concept or technique did we introduce?
3.  What changed in the system because of it?

------------------------------------------------------------------------

## 1. What problem did the previous version have?

The previous improvement made Agent Search adaptive.

It could now decide:

``` text
Should I search again?
```

instead of always performing multiple refinement rounds.

However, answer-producing searches still had another expensive step:

``` text
Retrieve
   ↓
Evidence verification LLM
   ↓
Generate answer
```

The evidence-verification call was still being performed whenever the
mode was not `quick`.

Our measurements showed that local retrieval was already very fast,
while LLM calls could take several seconds.

For example:

``` text
Embedding              ~1–3s
Retrieval              ~1–10ms
Evidence verification  ~3–59s
Answer generation      ~3–24s
```

So the next problem became:

> **Do we really need to call the evidence-verification LLM for every
> search when retrieval is already strong?**

We could not simply remove verification because strong retrieval does
not prove that the retrieved passages contain enough information to
answer the question.

------------------------------------------------------------------------

## 2. What concept did we introduce?

### Retrieval confidence

We introduced a lightweight confidence evaluation after retrieval.

The existing retrieval pipeline already produces signals such as:

``` text
dense score
dense score gap
BM25 score
BM25 score gap
dense/BM25 rank agreement
candidate count
```

Instead of using these signals only for debugging or Agent Search, we
now use them to make another routing decision:

> **Is the retrieval strong enough to avoid an expensive
> evidence-verification call?**

The evaluator produces:

``` ts
type RetrievalConfidence = {
  level: "high" | "medium" | "low";
  score: number;
  reasons: string[];
};
```

The purpose is not to calculate the probability that an answer is
correct.

It is a **routing signal**.

------------------------------------------------------------------------

## 3. Retrieval confidence is not answerability

This distinction is important.

``` text
Retrieval confidence
        ≠
Answerability
```

High retrieval confidence means:

> The retrieval result looks strong enough that, under the current MVP
> policy, we may not need an additional verification call.

It does **not** mean:

> The document definitely contains the answer.

The evidence verifier remains responsible for determining whether the
retrieved passages actually contain enough information to answer the
question.

This keeps the responsibilities separate:

``` text
Retrieval
   ↓
Find potentially relevant evidence

Confidence gate
   ↓
Decide whether verification is worth the cost

Evidence verifier
   ↓
Decide whether the evidence actually supports the answer

Answer generator
   ↓
Generate a grounded response
```

------------------------------------------------------------------------

## 4. What changed in the system?

Previously:

``` text
Question
   ↓
Embedding
   ↓
Hybrid retrieval
   ↓
Evidence verification
   ↓
Answer
```

Now:

``` text
Question
   ↓
Embedding
   ↓
Hybrid retrieval
   ↓
Retrieval confidence
   ↓
┌───────────────────────┐
│                       │
HIGH                MEDIUM / LOW
│                       │
Skip verification     Verify
│                       │
└───────────┬───────────┘
            ↓
          Answer
```

So evidence verification changed from an unconditional step into an
**adaptive gate**.

------------------------------------------------------------------------

## 5. Routing policy

The current MVP uses a simple policy:

``` text
HIGH
 ↓
Skip evidence verification
```

and:

``` text
MEDIUM / LOW
 ↓
Run evidence verification
```

If verification runs:

``` text
Evidence verifier
       ↓
Enough information?
   ┌───┴────┐
  YES       NO
   ↓         ↓
 Answer    Abstain
```

This preserves the existing abstention behavior for uncertain retrieval.

------------------------------------------------------------------------

## 6. Why not immediately abstain on LOW?

A low retrieval-confidence result does not automatically mean the
document has no answer.

It only means retrieval is weak or ambiguous.

Therefore we do not use:

``` text
LOW → "No information"
```

Instead:

``` text
LOW
 ↓
Evidence verification
 ↓
Is the answer actually supported?
```

This avoids turning a retrieval heuristic into an answerability
decision.

------------------------------------------------------------------------

## 7. How this interacts with Agent Search

The previous Agent Search improvement and this improvement make two
different decisions.

### Agent Search

``` text
Should I search again?
```

### Evidence gate

``` text
Should I verify the retrieved evidence?
```

The combined flow is now:

``` text
Question
   ↓
Initial retrieval
   ↓
Agent decides whether another search is useful
   ↓
Final retrieval
   ↓
Retrieval confidence
   ↓
Evidence gate
   ↓
Answer / Abstain
```

This means a search can legitimately reach:

``` text
Stop searching
+
Still verify evidence
```

For example, retrieval may be stable enough that another query rewrite
is unlikely to help, while still not being strong enough to skip
evidence verification.

The two decisions therefore remain independent.

------------------------------------------------------------------------

## 8. Latency impact

The important optimization is not local retrieval.

Retrieval is already measured in milliseconds.

The opportunity is avoiding unnecessary model calls.

If a query produces high retrieval confidence:

``` text
Embedding
   ↓
Retrieval
   ↓
Confidence = HIGH
   ↓
Answer
```

we can remove:

``` text
Evidence verification LLM
```

from that request.

This can save several seconds without changing the underlying retrieval
technology.

------------------------------------------------------------------------

## 9. Tradeoff

This optimization introduces a controlled tradeoff.

### Before

Every answer-producing search paid for evidence verification.

This was slower but conservative.

### After

Some high-confidence searches skip verification.

This is faster but places more responsibility on:

-   conservative confidence thresholds
-   grounded answer prompting
-   source retrieval quality

Therefore the confidence layer should not become an aggressive "trust
the retriever" mechanism.

It should remain conservative and observable.

------------------------------------------------------------------------

## 10. What we intentionally did not change

This improvement does not replace the current retrieval technology.

The existing retrieval remains:

``` text
Dense retrieval
     +
BM25
     ↓
RRF
     ↓
Relative score filtering
```

We did not introduce a new vector database, reranker, agent framework,
workflow engine, or different embedding technology.

The change is specifically about **when an expensive verification step
is necessary**.

------------------------------------------------------------------------

## 11. Result

The previous improvement made searching adaptive:

``` text
Search again only when useful.
```

This improvement makes evidence verification adaptive:

``` text
Verify only when retrieval confidence does not justify skipping it.
```

The resulting principle is:

> **Expensive model calls should be conditional decisions in the
> pipeline rather than mandatory steps.**

The architecture now has two independent optimization points:

``` text
Retrieval
   ↓
Should we search again?
   ↓
Should we verify?
   ↓
Answer
```

This keeps the system fast where possible while preserving the
evidence-verification path for uncertain retrieval.
