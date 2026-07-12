/**
 * Share repo — copy formatted snippets to clipboard.
 */
import type { Repo } from "./types.ts";

export type ShareFormat = "markdown" | "plain" | "gh-cli" | "short";

export function formatShare(repo: Repo, format: ShareFormat): string {
  switch (format) {
    case "markdown":
      return `[${repo.fullName}](${repo.url}) — ${repo.description ?? ""}`.trim();
    case "plain":
      return `${repo.fullName} — ${repo.description ?? ""} — ${repo.url}`.trim();
    case "gh-cli":
      return `gh repo view ${repo.fullName}`;
    case "short":
      return repo.fullName;
  }
}

/** Copy text to clipboard via platform command. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const p = process.platform;
    if (p === "win32") {
      const proc = Bun.spawn(["clip"], { stdin: "pipe" });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited;
    } else if (p === "darwin") {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited;
    } else {
      // Linux — try xclip, then wl-copy
      const cmd = Bun.which("xclip") ? ["xclip", "-selection", "clipboard"] :
        Bun.which("wl-copy") ? ["wl-copy"] : null;
      if (!cmd) return false;
      const proc = Bun.spawn(cmd, { stdin: "pipe" });
      proc.stdin.write(text);
      proc.stdin.end();
      await proc.exited;
    }
    return true;
  } catch {
    return false;
  }
}
