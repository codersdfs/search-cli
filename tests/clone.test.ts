/**
 * Clone-module tests.
 *
 * `cloneRepo` spawns git, so `spawn` is injected. These tests assert the exact
 * argv / cwd / env handed to git — including the GIT_TERMINAL_PROMPT guard that
 * keeps the TUI from blocking on a prompt nobody can answer — and drive every
 * outcome (success, non-zero exit, git missing, malformed ref) without running
 * git or touching the network.
 */
import { describe, test, expect, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { cloneRepo, gitErrorLine, GIT_MISSING_MESSAGE } from "../src/clone";

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ghfind-clone-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface SpawnCall {
  cmd: string;
  args: string[];
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: unknown;
  };
}

/**
 * A fake `spawn` that records how it was called and settles the child the way
 * the real one would — one tick later, so the listeners in cloneRepo are
 * attached before the events fire.
 */
function fakeSpawn(behaviour: {
  code?: number | null;
  error?: NodeJS.ErrnoException;
  stdout?: string;
  stderr?: string;
}) {
  const calls: SpawnCall[] = [];
  const impl = ((cmd: string, args: string[], opts: SpawnCall["opts"]) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (behaviour.stdout) child.stdout.emit("data", behaviour.stdout);
      if (behaviour.stderr) child.stderr.emit("data", behaviour.stderr);
      if (behaviour.error) child.emit("error", behaviour.error);
      else child.emit("close", behaviour.code ?? 0);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { impl, calls };
}

describe("cloneRepo — the command it runs", () => {
  test("clones over HTTPS by default, into <dir>/<name>", async () => {
    const dir = tempDir();
    const { impl, calls } = fakeSpawn({ code: 0 });
    const result = await cloneRepo("facebook/react", {
      dir,
      spawn: impl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe("git");
    expect(calls[0]?.args).toEqual([
      "clone",
      "https://github.com/facebook/react.git",
      join(resolve(dir), "react"),
    ]);
    // git creates the leaf dir; cwd stays the root the clone was asked for.
    expect(calls[0]?.opts.cwd).toBe(resolve(dir));
    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(result.dir).toBe(join(resolve(dir), "react"));
  });

  test("--ssh uses the git@github.com form", async () => {
    const { impl, calls } = fakeSpawn({ code: 0 });
    await cloneRepo("facebook/react", {
      dir: tempDir(),
      ssh: true,
      spawn: impl,
    });
    expect(calls[0]?.args[1]).toBe("git@github.com:facebook/react.git");
  });

  test("accepts the ref shapes parseRepoRef tolerates (@ and .git)", async () => {
    for (const ref of ["@facebook/react", "facebook/react.git"]) {
      const { impl, calls } = fakeSpawn({ code: 0 });
      await cloneRepo(ref, { dir: tempDir(), spawn: impl });
      expect(calls[0]?.args[1], `ref: ${ref}`).toBe(
        "https://github.com/facebook/react.git",
      );
    }
  });

  test("defaults the destination root to the cwd", async () => {
    const { impl, calls } = fakeSpawn({ code: 0 });
    const result = await cloneRepo("facebook/react", { spawn: impl });
    expect(calls[0]?.opts.cwd).toBe(resolve(process.cwd()));
    expect(result.dir).toBe(join(resolve(process.cwd()), "react"));
  });

  test("creates a --dir root that does not exist yet", async () => {
    const root = join(tempDir(), "deep", "nested", "clones");
    const { impl, calls } = fakeSpawn({ code: 0 });
    await cloneRepo("facebook/react", { dir: root, spawn: impl });
    expect(existsSync(root)).toBe(true);
    expect(calls[0]?.opts.cwd).toBe(resolve(root));
  });

  test("does not pre-check the target: git owns the existing-dir rule", async () => {
    const root = tempDir();
    // A non-empty target dir would make git fail — the point is that we still
    // hand it to git rather than refusing (or deleting) it ourselves.
    const { impl, calls } = fakeSpawn({
      code: 128,
      stderr:
        "fatal: destination path 'react' already exists and is not an empty directory.",
    });
    const result = await cloneRepo("facebook/react", {
      dir: root,
      spawn: impl,
    });
    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(128);
    expect(result.output).toContain("already exists");
  });
});

describe("cloneRepo — capture mode (the TUI's mode)", () => {
  test("forbids credential prompts and pipes git's output", async () => {
    const { impl, calls } = fakeSpawn({ code: 0 });
    await cloneRepo("facebook/react", { dir: tempDir(), spawn: impl });
    expect(calls[0]?.opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(calls[0]?.opts.env?.GIT_TERMINAL_PROMPT).toBe("0");
  });

  test("captures stdout and stderr into one output string", async () => {
    const { impl } = fakeSpawn({
      code: 128,
      stdout: "Cloning into 'react'...\n",
      stderr: "remote: Repository not found.\nfatal: repository not found\n",
    });
    const result = await cloneRepo("ghfind/nope", {
      dir: tempDir(),
      spawn: impl,
    });
    expect(result.output).toContain("Cloning into 'react'");
    expect(result.output).toContain("fatal: repository not found");
  });

  test("a non-zero exit is reported with git's own code", async () => {
    const { impl } = fakeSpawn({ code: 128, stderr: "fatal: whatever\n" });
    const result = await cloneRepo("a/b", { dir: tempDir(), spawn: impl });
    expect(result).toMatchObject({ ok: false, code: 128 });
  });
});

describe("cloneRepo — interactive mode (the CLI's mode)", () => {
  test("inherits stdio so progress renders and a prompt can be answered", async () => {
    const { impl, calls } = fakeSpawn({ code: 0 });
    await cloneRepo("facebook/react", {
      dir: tempDir(),
      interactive: true,
      spawn: impl,
    });
    expect(calls[0]?.opts.stdio).toBe("inherit");
    // No GIT_TERMINAL_PROMPT override: git must be allowed to ask.
    expect(calls[0]?.opts.env).toBe(process.env);
  });
});

describe("cloneRepo — failures we can name with certainty", () => {
  test("ENOENT on spawn reports git-missing, with no exit code", async () => {
    const err = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
    }) as NodeJS.ErrnoException;
    const { impl } = fakeSpawn({ error: err });
    const result = await cloneRepo("facebook/react", {
      dir: tempDir(),
      spawn: impl,
    });
    expect(result.error).toBe("git-missing");
    expect(result.ok).toBe(false);
    expect(result.code).toBeNull();
    expect(result.output).toContain("ENOENT");
  });

  test("the git-missing message tells you what to do", () => {
    expect(GIT_MISSING_MESSAGE).toContain("git not found on PATH");
  });

  test("a malformed ref throws before git is ever spawned", async () => {
    const { impl, calls } = fakeSpawn({ code: 0 });
    await expect(
      cloneRepo("not-a-repo-ref", { dir: tempDir(), spawn: impl }),
    ).rejects.toThrow(/is not a repo name/);
    expect(calls).toHaveLength(0);
  });
});

/**
 * `gitErrorLine` produces the text the TUI puts in the status bar, so it is the
 * user-visible half of a failed clone. It must never invent a cause — it picks
 * git's own diagnosis line and passes it through.
 */
describe("gitErrorLine", () => {
  test("prefers git's own diagnosis over the progress noise", () => {
    const output = [
      "Cloning into 'react'...",
      "remote: Repository not found.",
      "fatal: repository 'https://github.com/x/react.git/' not found",
    ].join("\n");
    expect(gitErrorLine(output)).toBe(
      "fatal: repository 'https://github.com/x/react.git/' not found",
    );
  });

  test("uses the remote: line when that is the only diagnosis", () => {
    const output = "Cloning into 'x'...\nremote: Repository not found.\n";
    expect(gitErrorLine(output)).toBe("remote: Repository not found.");
  });

  test("falls back to the last line when git printed no diagnosis", () => {
    expect(gitErrorLine("one\ntwo\nthree\n")).toBe("three");
  });

  test("handles CRLF, as Windows git emits", () => {
    const output = "Cloning into 'x'...\r\nfatal: boom\r\n";
    expect(gitErrorLine(output)).toBe("fatal: boom");
  });

  test("returns an empty string for empty output", () => {
    expect(gitErrorLine("")).toBe("");
    expect(gitErrorLine("\n\n  \n")).toBe("");
  });

  test("truncates a long line to the requested width, keeping the ellipsis", () => {
    const line = gitErrorLine(`fatal: ${"x".repeat(200)}`, 40);
    expect(line).toHaveLength(40);
    expect(line.endsWith("…")).toBe(true);
  });
});
