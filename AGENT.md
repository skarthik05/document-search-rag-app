Im learning by building AI application to understand core fundamentals. THe below is what Im planing

I’d actually avoid agents at the beginning

Most beginners jump straight into LangChain CrewAI AutoGen multi agent systems memory architectures and orchestration frameworks before they’ve even built a simple app that calls an LLM

My suggested path

Learn basic Python

Build a simple chatbot using an API

Add tool use

weather
calculator
database lookup
Tool-calling milestone
- Learned: the model proposes a named tool and structured arguments; the application validates and executes the tool, then supplies the result for the model's response.
- Implemented: an Ollama calculator tool for basic arithmetic. The expression is evaluated by a safe parser, and the result is added to the source-grounded answer prompt.
- Scope: calculator tool selection currently runs only with the Ollama provider; other providers retain their existing answer flow.
- Answer behavior: concise answer-and-citation formatting applies to both arithmetic and non-arithmetic answers; calculation guidance appears only when the calculator returns a result. Summary mode skips calculator selection and keeps its own prompt.
- Arithmetic result handling: when a calculator result is available, the answer route uses answer mode so a summary prompt cannot override the computed result with an insufficient-evidence response. Without a calculation result, the requested summary or answer mode is preserved.
web search

Add memory

Memory fundamentals
- Conversation history is short-term context for the current session; durable memory is selected information intentionally retained across sessions. They are related but are not the same feature.
- Store only information that improves future interactions: initially a bounded set of recent user/assistant turns; later, explicit user preferences or user-confirmed durable facts with provenance and timestamps.
- Do not treat full uploaded documents as memory because document retrieval already owns that data. Avoid retaining secrets, unconfirmed model inferences, and unlimited transcripts by default.
- Implemented short-term memory: retain the last 10 completed turns per active document in IndexedDB, expiring with the document after 24 hours. Send at most the latest 5 turns to retrieval and answer generation; document claims still require current retrieved evidence.
- Memory quality rule: source-only turns such as "3 relevant passages found" stay visible in the transcript but are excluded from follow-up retrieval and model conversation context; they are UI status, not conversational answers.
- Calculator routing: check for arithmetic results independently of answer/summary selection; a successful calculation uses concise answer generation, while a summary with no calculation remains a summary.
- Implemented long-term memory: users explicitly add and delete preferences or facts in a saved-memory panel. Entries persist in this browser until deleted; the latest 30 are sent to the configured AI provider with a question and are not treated as evidence about uploaded documents.
- Q&A UI learning: a transcript makes follow-up questions legible, keeps citations beside each answer, and lets users inspect retrieved evidence on demand. New conversation clears short-term history but leaves user-managed long-term memory intact.
- UI maintenance: shared conversation types live in `lib/conversation-types.ts`; active search progress is shown once in the pending answer, while global notices are for upload work and errors.

conversation history
user preferences
basic persistence

Add retrieval from documents

PDFs
notes
knowledge bases
RAG workflows

Human in the loop

Only then start looking at agent frameworks

A useful mental model

LLM equals brain
Tools equals hands
Memory equals notes
Agent equals brain plus hands plus notes plus a goal

A realistic first project

Build a personal assistant that can

answer questions about your notes
search a folder of PDFs
create a todo item
draft an email
retrieve information from a knowledge base

That’s already closer to a real agent than most tutorial projects

The biggest lesson is that production agents are usually much simpler than YouTube makes them look Most successful systems are just

a good prompt
a few reliable tools
clear guardrails
structured outputs
human approval where needed
lots of testing

The pattern I’ve seen repeatedly is that people who start with workflows learn faster than people who start with agent frameworks

Build something useful to yourself first

If you use it every day you’ll naturally discover the real problems

context management
memory retrieval
tool reliability
error handling
permissions
state persistence

Those are the things that actually matter in production systems much more than whether you’re using the latest agent framework.