/**
 * Storage adapter — single point of file I/O for state files.
 *
 * All domain modules (history, bookmarks, saved-searches, notifications,
 * session, config) delegate file I/O here.
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
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

/** Write a file atomically: temp file in the same dir, then rename. */
function writeFileAtomic(filename: string, data: string): void {
  ensureDir();
  const target = join(stateDir(), filename);
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data, "utf-8");
    renameSync(tmp, target);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp already gone
    }
    throw e;
  }
}

/** Write data as JSON to a file. */
export function writeJSON(filename: string, data: unknown): void {
  writeFileAtomic(filename, JSON.stringify(data, null, 2));
}

/** Append one JSON object as a line to a JSONL file. */
export function appendJSONL(filename: string, obj: unknown): void {
  ensureDir();
  try {
    appendFileSync(
      join(stateDir(), filename),
      `${JSON.stringify(obj)}\n`,
      "utf-8",
    );
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
    return raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

/** Write raw text to a file (bypasses JSON encoding). */
export function writeRaw(filename: string, data: string): void {
  writeFileAtomic(filename, data);
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
    appendFileSync(
      join(stateDir(), "ghfind-debug.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
      "utf-8",
    );
  } catch {
    /* ignore */
  }
}
