// Tests for the MCP server (ghfind mcp) — protocol + tool behavior.
// Network-touching tools run against a mocked globalThis.fetch, following
// the precedent in tests/org.test.ts. State files go to a temp state dir.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  processServerLine,
  callTool,
  toolSummaries,
  McpToolError,
  type ServerState,
} from "../src/mcp-server.ts";

const realFetch = globalThis.fetch;

// ─── Harness ───────────────────────────────────────────────────────────

let out: string[] = [];
const config = { write: (line: string) => out.push(line) };

function freshState(): ServerState {
  return { initialized: false };
}

/** Send one request, return the single response object. */
async function rpc(
  method: string,
  params?: Record<string, unknown>,
  state: ServerState = freshState(),
): Promise<Record<string, unknown>> {
  out = [];
  const line = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  await processServerLine(line, state, config);
  expect(out).toHaveLength(1);
  return JSON.parse(out[0]) as Record<string, unknown>;
}

function notif(
  method: string,
  params?: Record<string, unknown>,
  state: ServerState = freshState(),
): Promise<void> {
  out = [];
  const line = JSON.stringify({ jsonrpc: "2.0", method, params });
  return processServerLine(line, state, config);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function init(
  state: ServerState,
  protocolVersion = "2025-06-18",
): Promise<Record<string, unknown>> {
  return rpc(
    "initialize",
    { protocolVersion, clientInfo: { name: "test", version: "0" } },
    state,
  );
}

// Fixtures shared by search-backed tools.
const SEARCH_ITEMS = [
  {
    id: 1,
    name: "bun",
    full_name: "oven-sh/bun",
    owner: { login: "oven-sh" },
    description: "Incredibly fast JavaScript runtime",
    html_url: "https://github.com/oven-sh/bun",
    stargazers_count: 70000,
    forks_count: 2000,
    watchers_count: 70000,
    language: "Zig",
    topics: ["runtime"],
    archived: false,
    fork: false,
    private: false,
    created_at: "2021-01-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    pushed_at: "2026-09-10T00:00:00Z",
    score: 1,
  },
  {
    id: 2,
    name: "node",
    full_name: "nodejs/node",
    owner: { login: "nodejs" },
    description: "Node.js JavaScript runtime",
    html_url: "https://github.com/nodejs/node",
    stargazers_count: 100000,
    forks_count: 25000,
    watchers_count: 100000,
    language: "JavaScript",
    topics: [],
    archived: false,
    fork: false,
    private: false,
    created_at: "2014-01-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    pushed_at: "2026-09-15T00:00:00Z",
    score: 0.9,
  },
];

const searchEnvelope = {
  total_count: 2,
  incomplete_results: false,
  items: SEARCH_ITEMS,
};

// ─── Lifecycle & protocol ──────────────────────────────────────────────

describe("protocol", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("negotiates a supported protocol version", async () => {
    const state = freshState();
    const res = await init(state, "2025-06-18");
    expect(res.error).toBeUndefined();
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo).toMatchObject({ name: "ghfind" });
    expect((result.capabilities as Record<string, unknown>).tools).toEqual({
      listChanged: false,
    });
    expect(typeof result.instructions).toBe("string");
  });

  it("falls back to its latest version when the requested one is unsupported", async () => {
    const res = await rpc("initialize", { protocolVersion: "1.0.0" });
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2025-06-18");
  });

  it("rejects tools/list before initialization", async () => {
    const res = await rpc("tools/list");
    const err = res.error as Record<string, unknown>;
    expect(err.code).toBe(-32600);
    expect(String(err.message)).toContain("not initialized");
  });

  it("allows initialize and ping before initialization", async () => {
    const ping = await rpc("ping");
    expect(ping.result).toEqual({});
    const res = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(res.error).toBeUndefined();
  });

  it("returns tools from tools/list after initialization", async () => {
    const state = freshState();
    await init(state);
    const res = await rpc("tools/list", undefined, state);
    const tools = (res.result as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    const names = tools.map((t) => t.name);
    expect(names).toContain("ghfind_search_repos");
    expect(names).toContain("ghfind_trending");
    expect(names).toContain("ghfind_npm_packages");
    expect(names).toContain("ghfind_org_profile");
    expect(names).toContain("ghfind_user_profile");
    expect(names).toContain("ghfind_compare_repos");
    expect(names).toContain("ghfind_deep_dive");
    expect(names).toContain("ghfind_bookmarked_releases");
    expect(names).toContain("ghfind_skill");
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
      expect(typeof t.description).toBe("string");
    }
  });

  it("consumes the initialized notification silently", async () => {
    const state = freshState();
    await init(state);
    await notif("notifications/initialized", undefined, state);
    expect(out).toHaveLength(0);
    expect(state.initialized).toBe(true);
  });

  it("ignores unknown notifications and never responds to them", async () => {
    await notif("notifications/whatever");
    expect(out).toHaveLength(0);
  });

  it("responds to parse garbage with a parse error", async () => {
    out = [];
    await processServerLine("{not json", freshState(), config);
    const res = JSON.parse(out[0]) as Record<string, unknown>;
    expect((res.error as Record<string, unknown>).code).toBe(-32700);
  });

  it("returns method-not-found for prompts/resources (tools-only server)", async () => {
    const state = freshState();
    await init(state);
    for (const method of ["prompts/list", "resources/list"]) {
      const res = await rpc(method, undefined, state);
      expect((res.error as Record<string, unknown>).code).toBe(-32601);
    }
  });
});

// ─── Tool dispatch ─────────────────────────────────────────────────────

describe("tools/call dispatch", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects an unknown tool with a protocol error", async () => {
    const state = freshState();
    await init(state);
    const res = await rpc(
      "tools/call",
      { name: "no_such_tool", arguments: {} },
      state,
    );
    expect((res.error as Record<string, unknown>).code).toBe(-32602);
  });

  it("reports tool failures as isError results, not protocol errors", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const state = freshState();
    await init(state);
    const res = await rpc(
      "tools/call",
      {
        name: "ghfind_search_repos",
        arguments: { query: "rust", token: "tok" },
      },
      state,
    );
    expect(res.error).toBeUndefined();
    const result = res.result as Record<string, unknown>;
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("failed");
  });

  it("returns text + structuredContent on success", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(searchEnvelope)) as unknown as typeof fetch;
    const state = freshState();
    await init(state);
    const res = await rpc(
      "tools/call",
      {
        name: "ghfind_search_repos",
        arguments: { query: "javascript runtime", limit: 2 },
      },
      state,
    );
    const result = res.result as Record<string, unknown>;
    expect(result.isError).toBe(false);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("oven-sh/bun");
    const data = result.structuredContent as Record<string, unknown>;
    expect(data.totalCount).toBe(2);
    expect(Array.isArray(data.repos)).toBe(true);
  });
});

// ─── callTool unit tests ───────────────────────────────────────────────

describe("callTool: ghfind_search_repos", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws McpToolError on empty query", async () => {
    await expect(
      callTool("ghfind_search_repos", { query: "   " }, freshState()),
    ).rejects.toThrow(McpToolError);
  });

  it("throws McpToolError for an unknown tool name", async () => {
    await expect(callTool("nope", {}, freshState())).rejects.toThrow(
      "Unknown tool: nope",
    );
  });

  it("coerces out-of-range limits into range", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return jsonResponse(searchEnvelope);
    }) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_search_repos",
      { query: "rust", limit: 9999 },
      freshState(),
    );
    expect(calledUrl).toContain("per_page=100");
    expect(outcome.text).toContain("oven-sh/bun");
  });

  it("emits an empty-result message when nothing matches", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        total_count: 0,
        incomplete_results: false,
        items: [],
      })) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_search_repos",
      { query: "xyzzy-nonexistent" },
      freshState(),
    );
    expect(outcome.text).toContain("No repositories found");
    expect((outcome.data as Record<string, unknown>).totalCount).toBe(0);
  });

  it("flags rate limiting in structured output instead of failing", async () => {
    // A 403 with no rate-limit headers makes the adapter set rateLimited and
    // swallow the error — the tool reports it in structuredContent.
    globalThis.fetch = (async () =>
      jsonResponse(
        { message: "rate limited" },
        403,
      )) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_search_repos",
      { query: "rust" },
      freshState(),
    );
    expect(outcome.text).toContain("No repositories found");
    expect((outcome.data as Record<string, unknown>).rateLimited).toBe(true);
  });
});

describe("callTool: ghfind_trending", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  const TRENDING_HTML = `<article class="Box-row"><h2><a href="/vercel/next.js" class="Link">vercel/next.js</a></h2><p class="color-fg-muted">The React Framework</p></article><article class="Box-row"><h2><a href="/oven-sh/bun" class="Link">oven-sh/bun</a></h2><p class="color-fg-muted">Fast runtime</p></article>`;

  it("rejects an invalid language with a helpful error", async () => {
    await expect(
      callTool("ghfind_trending", { language: "klingon" }, freshState()),
    ).rejects.toThrow(/not a trending language/);
  });

  it("fetches the daily trending page and returns repos", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(TRENDING_HTML, { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await callTool("ghfind_trending", {}, freshState());
    expect(calledUrl).toBe("https://github.com/trending");
    expect(outcome.text).toContain("vercel/next.js");
    const data = outcome.data as Record<string, unknown>;
    expect(data.since).toBe("daily");
    expect(Array.isArray(data.repos)).toBe(true);
  });

  it("passes since + language to the URL", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(TRENDING_HTML, { status: 200 });
    }) as unknown as typeof fetch;
    await callTool(
      "ghfind_trending",
      { since: "weekly", language: "Rust" },
      freshState(),
    );
    expect(calledUrl).toBe(
      "https://github.com/trending?since=weekly&language=rust",
    );
  });
});

describe("callTool: ghfind_org_profile / ghfind_user_profile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  const ORG = {
    login: "vercel",
    name: "Vercel",
    description: null,
    html_url: "https://github.com/vercel",
    created_at: "2015-01-01T00:00:00Z",
    public_repos: 1,
  };
  const REPOS = [
    {
      full_name: "vercel/next.js",
      html_url: "https://github.com/vercel/next.js",
      description: "The React Framework",
      language: "JavaScript",
      stargazers_count: 120000,
      forks_count: 25000,
      pushed_at: "2026-09-01T00:00:00Z",
    },
  ];

  it("org profile returns text and structured data", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith("/orgs/vercel")) return jsonResponse(ORG);
      return jsonResponse(REPOS);
    }) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_org_profile",
      { org: "vercel" },
      freshState(),
    );
    expect(outcome.text).toContain("vercel");
    expect(outcome.data).toMatchObject({ login: "vercel" });
  });

  it("org profile surfaces the not-found error as McpToolError", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ message: "Not Found" }, 404)) as unknown as typeof fetch;
    await expect(
      callTool("ghfind_org_profile", { org: "nope-xyz" }, freshState()),
    ).rejects.toThrow(/not found/i);
  });

  it("user profile works with @ prefix", async () => {
    const USER = {
      login: "torvalds",
      name: "Linus Torvalds",
      type: "User",
      site_admin: false,
      html_url: "https://github.com/torvalds",
      created_at: "2011-01-01T00:00:00Z",
      followers: 200000,
      following: 0,
      public_repos: 1,
    };
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes("/users/torvalds")) return jsonResponse(USER);
      return jsonResponse(REPOS);
    }) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_user_profile",
      { user: "@torvalds" },
      freshState(),
    );
    expect(outcome.data).toMatchObject({ login: "torvalds" });
  });
});

describe("callTool: ghfind_compare_repos", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("builds a comparison table for found repos", async () => {
    // Each lookup searches for its own fullName — answer per query.
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      const items = u.includes("oven-sh")
        ? [SEARCH_ITEMS[0]]
        : [SEARCH_ITEMS[1]];
      return jsonResponse({ total_count: 1, items });
    }) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_compare_repos",
      { repos: ["oven-sh/bun", "nodejs/node"] },
      freshState(),
    );
    expect(outcome.text).toContain("oven-sh/bun");
    expect(outcome.text).toContain("nodejs/node");
  });

  it("requires at least 2 repos", async () => {
    await expect(
      callTool("ghfind_compare_repos", { repos: ["only/one"] }, freshState()),
    ).rejects.toThrow(/2-5/);
  });

  it("throws when fewer than 2 repos resolve", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ total_count: 0, items: [] })) as unknown as typeof fetch;
    await expect(
      callTool(
        "ghfind_compare_repos",
        { repos: ["ghost/one", "ghost/two"] },
        freshState(),
      ),
    ).rejects.toThrow(/Could not resolve/);
  });
});

describe("callTool: ghfind_deep_dive", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("validates the repo name format", async () => {
    await expect(
      callTool("ghfind_deep_dive", { repo: "not-a-repo" }, freshState()),
    ).rejects.toThrow(/owner\/name/);
  });

  it("returns deep-dive sections", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/languages")) return jsonResponse({ TypeScript: 1234 });
      if (u.includes("/contributors"))
        return jsonResponse([{ login: "kdy1", contributions: 900 }]);
      return new Response("# Hello\n\nWorld", { status: 200 });
    }) as unknown as typeof fetch;
    const outcome = await callTool(
      "ghfind_deep_dive",
      { repo: "oven-sh/bun" },
      freshState(),
    );
    expect(outcome.text).toContain("Summary");
    expect(outcome.text).toContain("TypeScript");
  });
});

describe("callTool: ghfind_bookmarked_releases + ghfind_skill", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("bookmarked_releases reports empty state without bookmarks", async () => {
    const outcome = await callTool(
      "ghfind_bookmarked_releases",
      {},
      freshState(),
    );
    expect(outcome.text).toContain("No bookmarks yet");
    expect((outcome.data as Record<string, unknown>).bookmarkCount).toBe(0);
  });

  it("ghfind_skill returns the CLI guide", async () => {
    const outcome = await callTool("ghfind_skill", {}, freshState());
    expect(outcome.text).toContain("ghfind");
    expect(outcome.text).toContain("--json");
    expect(outcome.data).toMatchObject({ name: "ghfind-cli" });
  });
});

describe("callTool: ghfind_skill_search", () => {
  let tmp: string;
  let skillsRoot: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-mcp-"));
    process.env.XDG_STATE_HOME = tmp;
    skillsRoot = join(tmp, "skills");
    mkdirSync(join(skillsRoot, "changelog"), { recursive: true });
    writeFileSync(
      join(skillsRoot, "changelog", "SKILL.md"),
      "---\nname: changelog\ndescription: write changelogs\n---\n# changelog\n",
    );
    mkdirSync(join(skillsRoot, "testing"), { recursive: true });
    writeFileSync(
      join(skillsRoot, "testing", "SKILL.md"),
      "---\nname: testing\ndescription: write tests\n---\n# testing\n",
    );
    process.env.GHFIND_SKILL_ROOTS = skillsRoot;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.GHFIND_SKILL_ROOTS;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("searches installed skills by default (source=local)", async () => {
    const outcome = await callTool(
      "ghfind_skill_search",
      { query: "changelog" },
      freshState(),
    );
    expect(outcome.text).toContain("installed skills on this machine");
    expect(outcome.text).toContain("changelog");
    expect(outcome.data?.source).toBe("local");
    expect(outcome.data?.count).toBe(1);
  });

  it("returns the structured result agents parse", async () => {
    const outcome = await callTool(
      "ghfind_skill_search",
      { query: "test", limit: 5 },
      freshState(),
    );
    const skills = outcome.data?.skills as Array<Record<string, unknown>>;
    expect(skills[0].name).toBe("testing");
    // Origins are display paths: separators normalized, home abbreviated.
    const displayRoot = skillsRoot
      .replace(/\\/g, "/")
      .replace(homedir().replace(/\\/g, "/"), "~");
    expect(skills[0].origin).toBe(displayRoot);
    expect(outcome.data).toMatchObject({ query: "test", source: "local" });
  });

  it("searches the skills.sh registry when asked", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return jsonResponse({
        query: "react",
        skills: [
          {
            id: "vercel-labs/agent-skills/react",
            source: "vercel-labs/agent-skills",
            skillId: "react",
            name: "react",
            installs: 743406,
          },
        ],
      });
    }) as unknown as typeof fetch;

    const outcome = await callTool(
      "ghfind_skill_search",
      { query: "react", source: "registry" },
      freshState(),
    );
    expect(calledUrl).toContain("skills.sh/api/search");
    expect(outcome.data?.source).toBe("registry");
    expect(outcome.text).toContain(
      "npx skills add vercel-labs/agent-skills@react",
    );
  });

  it("falls back to the local source for an unknown source value", async () => {
    const outcome = await callTool(
      "ghfind_skill_search",
      { query: "changelog", source: "nonsense" },
      freshState(),
    );
    expect(outcome.data?.source).toBe("local");
  });

  it("reports a too-short query as a tool error", async () => {
    await expect(
      callTool("ghfind_skill_search", { query: "x" }, freshState()),
    ).rejects.toThrow(McpToolError);
  });

  it("reports an empty result without failing", async () => {
    const outcome = await callTool(
      "ghfind_skill_search",
      { query: "nothing-matches-this" },
      freshState(),
    );
    expect(outcome.data?.count).toBe(0);
    expect(outcome.text).toContain("0 match(es)");
  });
});

describe("toolSummaries", () => {
  it("exposes name/title/description/inputSchema only (no run)", () => {
    for (const t of toolSummaries()) {
      expect(Object.keys(t).sort()).toEqual([
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });
});
