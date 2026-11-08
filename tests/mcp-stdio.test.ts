// End-to-end MCP stdio test for ghfind_similar_repos.
//
// Spawns the real `ghfind mcp` server as a child process, preloads a fetch
// stub (tests/fixtures/mcp-mock-fetch.ts) so GitHub is never contacted, and
// speaks JSON-RPC over the server's stdin/stdout. Unlike the in-process
// tests in mcp-server.test.ts, this exercises the CLI entry, the stdio
// transport, line framing, dispatch, and response encoding together.
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(process.cwd(), "src", "cli.ts");
const PRELOAD = join(process.cwd(), "tests", "fixtures", "mcp-mock-fetch.ts");
const BUN = process.execPath.includes("bun") ? process.execPath : "bun";

/** One JSON-RPC line per request; the initialized notification gets no id. */
const REQUESTS = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "mcp-stdio-test", version: "0" },
      capabilities: {},
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "ghfind_similar_repos",
      arguments: { repo: "oven-sh/bun", limit: 5 },
    },
  },
];

function parseResponses(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("MCP stdio: ghfind_similar_repos", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("serves similar repos over stdin/stdout", () => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-stdio-"));
    const input = `${REQUESTS.map((r) => JSON.stringify(r)).join("\n")}\n`;

    const child = spawnSync(BUN, ["--preload", PRELOAD, CLI, "mcp"], {
      input,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        // Keep state (search cache) inside the test dir and avoid a real token.
        XDG_STATE_HOME: tmp,
        GITHUB_TOKEN: "",
      },
    });

    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);

    const responses = parseResponses(child.stdout ?? "");
    // Three requests with ids; the initialized notification is never answered.
    expect(responses).toHaveLength(3);

    const init = responses.find((r) => r.id === 1);
    expect(init?.error).toBeUndefined();
    const initResult = init?.result as Record<string, unknown>;
    expect(initResult.protocolVersion).toBe("2025-06-18");

    const list = responses.find((r) => r.id === 2);
    expect(list?.error).toBeUndefined();
    const listResult = list?.result as Record<string, unknown> | undefined;
    const tools =
      (listResult?.tools as Array<Record<string, unknown>> | undefined) ?? [];
    expect(tools.map((t) => t.name)).toContain("ghfind_similar_repos");

    const call = responses.find((r) => r.id === 3);
    expect(call?.error).toBeUndefined();
    const result = call?.result as Record<string, unknown>;
    expect(result.isError).toBe(false);

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Similar to oven-sh/bun — 1 repo");
    expect(content[0].text).toContain("nodejs/node");

    const data = result.structuredContent as Record<string, unknown>;
    expect(data.count).toBe(1);
    const repos = data.repos as Array<Record<string, unknown>>;
    expect(repos.map((r) => r.fullName)).toEqual(["nodejs/node"]);
    expect((data.queries as string[]).join(" ")).toContain("topic:runtime");
  });
});
