/**
 * Pipe-friendly format modifiers — output repo data as lines for shell piping.
 */
import type { Repo } from "./types.ts";
import { openUrl } from "./open-url.ts";

export type FormatLine = "urls" | "names" | "ssh-urls" | "clone-commands" | "ids";

export function formatUrls(repos: Repo[]): string {
  return repos.map((r) => r.url).join("\n");
}

export function formatNames(repos: Repo[]): string {
  return repos.map((r) => r.fullName).join("\n");
}

export function formatSshUrls(repos: Repo[]): string {
  return repos.map((r) => `git@github.com:${r.fullName}.git`).join("\n");
}

export function formatCloneCommands(repos: Repo[]): string {
  return repos.map((r) => `git clone git@github.com:${r.fullName}.git`).join("\n");
}

export function formatIds(repos: Repo[]): string {
  return repos.map((r) => String(r.id)).join("\n");
}

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


