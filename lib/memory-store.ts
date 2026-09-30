"use client";

import { openAppDb } from "./app-db";
import type {
  ConversationTurn,
  LongTermMemory,
} from "./conversation-types";
import { MAX_CONVERSATION_TURNS } from "./memory-limits";

type StoredConversation = {
  expiresAt: number;
  turns: ConversationTurn[];
};

export async function getConversation(
  documentId: string,
  documentExpiresAt: number,
): Promise<ConversationTurn[]> {
  const database = await openAppDb();
  const conversation = (await database.get(
    "conversations",
    documentId,
  )) as StoredConversation | undefined;
  if (!conversation) return [];
  if (conversation.expiresAt <= Date.now() || documentExpiresAt <= Date.now()) {
    await database.delete("conversations", documentId);
    return [];
  }
  return conversation.turns;
}

export async function saveConversation(
  documentId: string,
  expiresAt: number,
  turns: ConversationTurn[],
) {
  const boundedTurns = turns
    .filter((turn) => Boolean(turn.answer))
    .slice(-MAX_CONVERSATION_TURNS)
    .map((turn) => ({
      ...turn,
      sources: turn.sources.map(({ id, text, page, score, denseScore, sparseScore, sourceId }) => ({
        id,
        text,
        page,
        score,
        denseScore,
        sparseScore,
        sourceId,
      })),
    }));
  await (await openAppDb()).put(
    "conversations",
    { expiresAt, turns: boundedTurns } satisfies StoredConversation,
    documentId,
  );
}

export async function clearConversation(documentId: string) {
  await (await openAppDb()).delete("conversations", documentId);
}

export async function pruneExpiredConversations() {
  const database = await openAppDb();
  const [keys, conversations] = await Promise.all([
    database.getAllKeys("conversations"),
    database.getAll("conversations") as Promise<StoredConversation[]>,
  ]);
  await Promise.all(
    conversations.map((conversation, index) =>
      conversation.expiresAt <= Date.now()
        ? database.delete("conversations", keys[index])
        : Promise.resolve(),
    ),
  );
}

const LONG_TERM_MEMORY_KEY = "user-approved-memories";

export async function getLongTermMemories(): Promise<LongTermMemory[]> {
  return (
    (await (await openAppDb()).get(
      "long-term-memories",
      LONG_TERM_MEMORY_KEY,
    )) as LongTermMemory[] | undefined
  ) || [];
}

export async function addLongTermMemory(text: string): Promise<LongTermMemory[]> {
  const database = await openAppDb();
  const memories = await getLongTermMemories();
  const next = [
    ...memories,
    { id: crypto.randomUUID(), text: text.trim(), createdAt: Date.now() },
  ];
  await database.put("long-term-memories", next, LONG_TERM_MEMORY_KEY);
  return next;
}

export async function deleteLongTermMemory(id: string): Promise<LongTermMemory[]> {
  const database = await openAppDb();
  const next = (await getLongTermMemories()).filter((memory) => memory.id !== id);
  await database.put("long-term-memories", next, LONG_TERM_MEMORY_KEY);
  return next;
}