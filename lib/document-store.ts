"use client";
import { openAppDb } from "./app-db";
import type { StoredDocument } from "./types";
const KEY = "active-document";
export async function getActiveDocument(): Promise<StoredDocument | null> {
  const value = (await (await openAppDb()).get("documents", KEY)) as
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
  await (await openAppDb()).put("documents", document, KEY);
}
export async function clearActiveDocument() {
  await (await openAppDb()).delete("documents", KEY);
}
