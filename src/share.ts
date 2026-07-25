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
import { spawn } from "child_process";

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const p = process.platform;
    const cmd = p === "win32" ? ["clip"] : p === "darwin" ? ["pbcopy"] : await findLinuxClipCmd();
    if (!cmd) return false;
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    proc.stdin.write(text);
    proc.stdin.end();
    return new Promise((resolve) => {
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

async function findLinuxClipboard(): Promise<string[] | null> {
  const { execFileSync } = await import("child_process");
  try {
    execFileSync("xclip", ["-version"], { stdio: "ignore" });
    return ["xclip", "-selection", "clipboard"];
  } catch {
    try {
      execFileSync("wl-copy", ["--version"], { stdio: "ignore" });
      return ["wl-copy"];
    } catch {
      return null;
    }
  }
}
