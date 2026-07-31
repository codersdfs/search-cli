/**
 * Storage adapter — single point of file I/O for state files.
 *
 * All domain modules (history, bookmarks, saved-searches, notifications,
 * session, config) delegate file I/O here. Swap for an in-memory
 * implementation in tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from "fs";
import { join } from "path";
import { stateDir } from "./config";

/** Ensure the state directory exists. */
function ensureDir(): void {
  mkdirSync(stateDir(), { recursive: true });
}

/** Read and parse a JSON file. Returns `fallback` on any error. */
export function readJSON<T>(filename: string, fallback: T): T {
  ensureDir();
  try {
    return JSON.parse(readFileSync(join(stateDir(), filename), "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/** Write data as JSON to a file. */
export function writeJSON(filename: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(stateDir(), filename), JSON.stringify(data, null, 2));
}

/** Append one JSON object as a line to a JSONL file. */
export function appendJSONL(filename: string, obj: unknown): void {
  ensureDir();
  try {
    appendFileSync(join(stateDir(), filename), JSON.stringify(obj) + "\n", "utf-8");
  } catch {
    // non-critical
  }
}

/** Read all lines from a JSONL file, parsing each as JSON. */
export function readJSONL<T>(filename: string): T[] {
  ensureDir();
  try {
    const raw = readFileSync(join(stateDir(), filename), "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

/** Write raw text to a file (bypasses JSON encoding). */
export function writeRaw(filename: string, data: string): void {
  ensureDir();
  writeFileSync(join(stateDir(), filename), data);
}

/** Delete a file if it exists. */
export function deleteFile(filename: string): void {
  try {
    unlinkSync(join(stateDir(), filename));
  } catch {
    // non-critical
  }
}

/** Append a timestamped debug line to ghfind-debug.log (only when DEBUG is set). */
export function debugLog(msg: string): void {
  if (!process.env.DEBUG) return;
  try {
    appendFileSync(join(stateDir(), "ghfind-debug.log"), `[${new Date().toISOString()}] ${msg}\n`, "utf-8");
  } catch { /* ignore */ }
}

/** Check if a file exists in the state dir. */
export function fileExists(filename: string): boolean {
  return existsSync(join(stateDir(), filename));
}

// ─── In-memory implementation for tests ────────────────────────────────

const memStore = new Map<string, string>();

export const memoryStorage = {
  readJSON<T>(filename: string, fallback: T): T {
    const raw = memStore.get(filename);
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  },
  writeJSON(filename: string, data: unknown): void {
    memStore.set(filename, JSON.stringify(data, null, 2));
  },
  appendJSONL(filename: string, obj: unknown): void {
    const existing = memStore.get(filename) ?? "";
    memStore.set(filename, existing + JSON.stringify(obj) + "\n");
  },
  readJSONL<T>(filename: string): T[] {
    const raw = memStore.get(filename);
    if (!raw) return [];
    return raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as T);
  },
  clear(): void { memStore.clear(); },
};
