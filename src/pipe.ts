/**
 * Pipe-friendly format modifiers — output repo data as lines for shell piping.
 */
import type { Repo } from "./types.ts";

export type FormatLine = "urls" | "names" | "ssh-urls" | "clone-commands" | "ids";

/** Format repos as one URL per line. */
export function formatUrls(repos: Repo[]): string {
  return repos.map((r) => r.url).join("\n");
}

/** Format repos as one owner/repo per line. */
export function formatNames(repos: Repo[]): string {
  return repos.map((r) => r.fullName).join("\n");
}

/** Format repos as one git@github.com URL per line. */
export function formatSshUrls(repos: Repo[]): string {
  return repos.map((r) => `git@github.com:${r.fullName}.git`).join("\n");
}

/** Format repos as ready-to-paste git clone commands. */
export function formatCloneCommands(repos: Repo[]): string {
  return repos.map((r) => `git clone git@github.com:${r.fullName}.git`).join("\n");
}

/** Format repos as GitHub repo IDs, one per line. */
export function formatIds(repos: Repo[]): string {
  return repos.map((r) => String(r.id)).join("\n");
}

/** Format repos in the given line format. */
export function formatLines(repos: Repo[], format: FormatLine): string {
  switch (format) {
    case "urls": return formatUrls(repos);
    case "names": return formatNames(repos);
    case "ssh-urls": return formatSshUrls(repos);
    case "clone-commands": return formatCloneCommands(repos);
    case "ids": return formatIds(repos);
  }
}

/** Execute a pipe target (clone, open) on repos. */
export async function pipeExec(repos: Repo[], target: string): Promise<void> {
  for (const repo of repos) {
    const url = repo.url;
    switch (target) {
      case "open":
        await openUrl(url);
        break;
      case "clone":
        console.log(`git clone git@github.com:${repo.fullName}.git`);
        break;
    }
  }
}

async function openUrl(url: string): Promise<void> {
  const p = process.platform;
  const args = p === "win32" ? ["cmd", "/c", "start", "", url]
    : p === "darwin" ? ["open", url]
    : ["xdg-open", url];
  Bun.spawn(args);
}
