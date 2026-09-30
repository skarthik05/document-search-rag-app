import { openDB } from "idb";

const DB_NAME = "source-search";
const DB_VERSION = 2;

export function openAppDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("documents")) {
        database.createObjectStore("documents");
      }
      if (!database.objectStoreNames.contains("conversations")) {
        database.createObjectStore("conversations");
      }
      if (!database.objectStoreNames.contains("long-term-memories")) {
        database.createObjectStore("long-term-memories");
      }
    },
  });
}