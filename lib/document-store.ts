"use client";
import { openDB } from "idb";
import type { StoredDocument } from "./types";
const DB_NAME = "source-search";
const KEY = "active-document";
async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("documents")) {
        database.createObjectStore("documents");
      }
    },
  });
}
export async function getActiveDocument(): Promise<StoredDocument | null> {
  const value = (await (await db()).get("documents", KEY)) as
    | StoredDocument
    | undefined;
  if (!value) return null;
  if (value.expiresAt <= Date.now()) {
    await clearActiveDocument();
    return null;
  }
  return value;
}
export async function saveActiveDocument(document: StoredDocument) {
  await (await db()).put("documents", document, KEY);
}
export async function clearActiveDocument() {
  await (await db()).delete("documents", KEY);
}
