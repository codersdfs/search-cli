/**
 * clone.ts — clone a repository to disk (`ghfind clone`, and the TUI's Clone
 * action both drive this one function).
 *
 * Deliberately does NOT consult the GitHub API. A clone needs only owner/name,
 * and gating it behind the unauthenticated 60/hr budget would refuse to clone a
 * repository git itself can fetch fine. `parseRepoRef` validates the shape of
 * the ref (and tolerates `@owner/name.git`); git stays the source of truth for
 * whether the repo exists and whether we may read it.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRepoRef } from "./deepdive";

/** Set when the failure is one we can name with certainty. */
export type CloneFailure = "git-missing";

export interface CloneResult {
  ok: boolean;
  /** Absolute path of the clone target — `<dir>/<name>`, like plain `git clone`. */
  dir: string;
  /** git's exit code, or null when git never ran. */
  code: number | null;
  /** git's stdout+stderr. Empty in `interactive` mode (the terminal showed it). */
  output: string;
  error?: CloneFailure;
}

export interface CloneOptions {
  /** Directory to clone INTO — the repo gets a `<name>` subdirectory. Default: cwd. */
  dir?: string;
  /** Use the `git@github.com:owner/name.git` SSH form instead of HTTPS. */
  ssh?: boolean;
  /**
   * true — the caller owns a terminal (CLI): git inherits stdio, so its progress
   * bar renders and a credential prompt can be answered; the exit code is
   * returned verbatim. false (default) — capture git's output and forbid
   * prompts, which is the only safe mode while the TUI owns the screen.
   */
  interactive?: boolean;
  /** Injectable for tests. Defaults to node:child_process.spawn. */
  spawn?: typeof spawn;
}

/**
 * Clone `ref` ("owner/name") to `<dir>/<name>`.
 *
 * Throws (from `parseRepoRef`) for a malformed ref — the caller gets a
 * user-facing usage error, not a result object. Existing target directories are
 * NOT pre-checked: git's own rule applies, so an empty dir is reused and a
 * non-empty one fails with git's "destination path already exists".
 */
export async function cloneRepo(
  ref: string,
  opts: CloneOptions = {},
): Promise<CloneResult> {
  const { owner, name } = parseRepoRef(ref);
  const url = opts.ssh
    ? `git@github.com:${owner}/${name}.git`
    : `https://github.com/${owner}/${name}.git`;

  const root = resolve(opts.dir ?? process.cwd());
  const target = join(root, name);
  // git creates `target` itself but not missing parents, so create the root.
  mkdirSync(root, { recursive: true });

  const spawnFn = opts.spawn ?? spawn;
  const interactive = opts.interactive === true;

  return new Promise<CloneResult>((settle) => {
    let output = "";
    const child = spawnFn("git", ["clone", url, target], {
      cwd: root,
      env: interactive
        ? process.env
        : // The TUI has nowhere to render a prompt, so let git fail loudly
          // instead of blocking on a username/password nobody can type.
          { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      settle({
        ok: false,
        dir: target,
        code: null,
        output: output || err.message,
        error: err.code === "ENOENT" ? "git-missing" : undefined,
      });
    });

    child.on("close", (code) => {
      settle({ ok: code === 0, dir: target, code, output });
    });
  });
}

/** The message shown when git is not installed — the one failure we diagnose ourselves. */
export const GIT_MISSING_MESSAGE =
  "git not found on PATH — install git and retry.";

/**
 * The most useful single line of git's output, for a one-line status message.
 *
 * git's own `fatal:` / `remote:` line is the diagnosis; `Cloning into 'x'...`
 * is progress noise, so a diagnosis line wins, then the last line. Nothing is
 * rewritten — the status bar shows git's own words, and the full log goes to
 * GHFIND_LOG. Lives here rather than in the TUI so the text that reaches the
 * user is covered by tests.
 */
export function gitErrorLine(output: string, maxLength = 88): string {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const diagnosis = [...lines]
    .reverse()
    .find((l) => /^(fatal|remote|error):/i.test(l));
  const line = diagnosis ?? lines[lines.length - 1] ?? "";
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line;
}
