/**
 * Notification center — ephemeral alerts for rate limits, watch changes, etc.
 * 
 * ponytail: in-memory + last-session persistence. Skip 24h auto-clean.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { stateDir } from "./config.ts";

export interface Notification {
  id: number;
  type: "info" | "warning" | "rate-limit" | "watch-change" | "upgrade";
  icon: string;
  message: string;
  timestamp: number;
}

let nextId = 1;
let notifs: Notification[] = [];
const MAX_NOTIFS = 50;
const FILE = join(stateDir(), "notifications.json");

function load(): void {
  try {
    notifs = JSON.parse(readFileSync(FILE, "utf-8"));
    nextId = (Math.max(...notifs.map((n) => n.id), 0) + 1);
  } catch {
    notifs = [];
  }
}

function save(): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(FILE, JSON.stringify(notifs));
}

export function addNotification(type: Notification["type"], message: string): Notification {
  if (notifs.length === 0) load();
  const n: Notification = { id: nextId++, type, icon: iconFor(type), message, timestamp: Date.now() };
  notifs.unshift(n);
  if (notifs.length > MAX_NOTIFS) notifs = notifs.slice(0, MAX_NOTIFS);
  save();
  return n;
}

function iconFor(type: Notification["type"]): string {
  switch (type) {
    case "info": return "ℹ";
    case "warning": return "⚠";
    case "rate-limit": return "🚫";
    case "watch-change": return "🔔";
    case "upgrade": return "📦";
  }
}

export function getNotifications(): Notification[] {
  if (notifs.length === 0) load();
  return [...notifs];
}

export function dismissNotification(id: number): void {
  notifs = notifs.filter((n) => n.id !== id);
  save();
}

export function dismissAll(): void {
  notifs = [];
  save();
}
