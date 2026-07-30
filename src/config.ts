/**
 * Config system: load/save config from XDG paths, merge with env vars.
 * 
 * Lookup order:
 *   1. GHFIND_CONFIG env var
 *   2. $XDG_CONFIG_HOME/ghfind/config.json
 *   3. ~/.config/ghfind/config.json
 */
import type { Config } from "./types";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, readFileSync, writeFileSync } from "fs";

/** Directory for persistent state (history, bookmarks, session). */
export function stateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg ? join(xdg, "ghfind") : join(homedir(), ".local", "share", "ghfind");
  return base;
}

/** Directory for cache files. */
export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg ? join(xdg, "ghfind") : join(homedir(), ".cache", "ghfind");
  return base;
}
const DEFAULTS: Config = {
  defaultSort: "best-match",
  defaultLimit: 50,
  theme: "tokyo-night",
  cacheTtlSeconds: 300,
  defaultTab: "search",
};

export function configPath(): string {
  const envPath = process.env.GHFIND_CONFIG;
  if (envPath) return envPath;

  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, "ghfind") : join(homedir(), ".config", "ghfind");
  return join(base, "config.json");
}

export function loadConfig(): Config {
  const path = configPath();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return mergeWithEnv({ ...DEFAULTS, ...parsed });
  } catch {
    return mergeWithEnv({ ...DEFAULTS });
  }
}

export function saveConfig(config: Config): void {
  const path = configPath();
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function mergeWithEnv(config: Config): Config {
  if (process.env.GITHUB_TOKEN) config.githubToken = process.env.GITHUB_TOKEN;
  return config;
}
