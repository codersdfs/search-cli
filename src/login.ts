/**
 * `ghfind login` — store a GitHub token for higher rate limits.
 *
 * Detects a token already managed by the GitHub CLI (`gh`) and offers to
 * import it; otherwise accepts a pasted token. Writes to the same config file
 * used by `ghfind init` (~/.config/ghfind/config.json). `GITHUB_TOKEN` in the
 * environment always takes precedence at runtime (see src/config.ts).
 */
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig, saveConfig, configPath } from "./config";
import type { Config } from "./types";

/** Prefixes that identify a GitHub-issued credential. */
export const TOKEN_PREFIXES = ["ghp_", "gho_", "github_pat_"] as const;

/** True when the string looks like a GitHub-issued token. */
export function isLikelyGithubToken(token: string): boolean {
  return TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/** Mask a token for display: `ghp_ab…wxyz`. */
export function maskToken(token: string): string {
  if (token.length <= 11) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 7)}…${token.slice(-4)}`;
}

/** Directory where the `gh` CLI stores credentials. */
export function ghCliConfigDir(): string {
  return process.env.GH_CONFIG_DIR || join(homedir(), ".config", "gh");
}

/**
 * Extract the `oauth_token` for a given host from `hosts.yml` (the gh CLI
 * credential file). Top-level host keys are scanned line-by-line so tokens
 * belonging to other hosts are never picked up.
 */
export function parseHostsYmlToken(
  text: string,
  host = "github.com",
): string | undefined {
  let inHost = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Top-level key, e.g. `github.com:` or `github.com:\n` at column 0.
    if (/^[A-Za-z0-9.-]+:\s*$/.test(trimmed)) {
      inHost = trimmed.slice(0, -1).trim() === host;
      continue;
    }
    if (inHost) {
      const match = trimmed.match(/^oauth_token:\s*["']?([^"'\s]+)/);
      if (match) return match[1];
    }
  }
  return undefined;
}

/** Read the gh CLI token for `host` (default `github.com`) if one exists. */
export function readGhCliToken(
  ghDir: string = ghCliConfigDir(),
  host = process.env.GH_HOST ?? "github.com",
): string | undefined {
  const hostsFile = join(ghDir, "hosts.yml");
  if (!existsSync(hostsFile)) return undefined;
  try {
    return parseHostsYmlToken(readFileSync(hostsFile, "utf-8"), host);
  } catch {
    return undefined;
  }
}

/** Write the token into the loaded config and persist it. */
export function persistToken(
  token: string,
  deps: Pick<LoginDeps, "readConfig" | "writeConfig">,
): void {
  const config = deps.readConfig();
  config.githubToken = token;
  deps.writeConfig(config);
}

/** Interactive pieces of the wizard, injectable for testing. */
export interface LoginDeps {
  ask: (query: string) => Promise<string>;
  readGhCliToken: () => string | undefined;
  readConfig: () => Config;
  writeConfig: (config: Config) => void;
}

/** Command-line yes/no + free-text prompt helper. */
export function createAsk(): (query: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return (query) =>
    new Promise((resolve) => {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
}

/** Production defaults for the wizard dependencies. */
export function defaultLoginDeps(): LoginDeps {
  return {
    ask: createAsk(),
    readGhCliToken: () => readGhCliToken(),
    readConfig: loadConfig,
    writeConfig: (config) => saveConfig(config),
  };
}

function successNote(): string[] {
  return [
    "  Authentication raises the search rate limit from 60 to",
    "  5,000 requests/hour. Remove the token anytime by editing",
    `  ${configPath()} — delete the "githubToken" line and save.`,
  ];
}

/** `ghfind login` wizard: import from gh CLI or accept a pasted token. */
export async function runLoginWizard(
  deps: LoginDeps = defaultLoginDeps(),
): Promise<void> {
  const { ask } = deps;
  console.log("");
  console.log("  ghfind login");
  console.log("  ────────────");
  console.log("");

  if (process.env.GITHUB_TOKEN) {
    console.log(
      "  ℹ GITHUB_TOKEN is set in the environment and already takes precedence.",
    );
    console.log("");
  }

  const current = deps.readConfig();
  if (current.githubToken) {
    console.log(
      `  ✓ A token is already saved: ${maskToken(current.githubToken)}`,
    );
  }

  const ghToken = deps.readGhCliToken();
  if (ghToken) {
    console.log("  ✓ Found a token managed by the GitHub CLI (gh).");
    const answer = await ask("  Import it into ghfind? [Y/n]: ");
    if (answer.toLowerCase() !== "n") {
      persistToken(ghToken, deps);
      finishLogin(ghToken);
      return;
    }
  }

  const pasted = await ask("  Paste a GitHub token (Enter to skip): ");
  if (!pasted) {
    console.log("  Skipped — no token saved.");
    console.log("");
    return;
  }

  if (!isLikelyGithubToken(pasted)) {
    console.log(
      `  ⚠ That doesn't look like a GitHub token (expected one of: ${TOKEN_PREFIXES.join(", ")}).`,
    );
    const confirm = await ask("  Save it anyway? [y/N]: ");
    if (confirm.toLowerCase() !== "y") {
      console.log("  Cancelled — nothing saved.");
      console.log("");
      return;
    }
  }

  persistToken(pasted, deps);
  finishLogin(pasted);
}

function finishLogin(token: string): void {
  console.log(`  ✓ Token saved to ${configPath()}`);
  console.log(`    (masked: ${maskToken(token)})`);
  console.log("");
  for (const line of successNote()) console.log(line);
  console.log("");
}
