// Tests for skill-finder — the skill search behind `ghfind skill search`
// and the MCP ghfind_skill_search tool.
//
// Local scans run against fixture directories under a temp dir; registry
// searches run against a mocked globalThis.fetch, following the precedent in
// tests/org.test.ts.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  clampLimit,
  formatSkillSearchJson,
  formatSkillSearchNames,
  formatSkillSearchText,
  parseSkillFrontmatter,
  rankLocalSkills,
  resolveSkillRoots,
  scanLocalSkills,
  searchLocalSkills,
  searchRegistrySkills,
  searchSkills,
  MIN_QUERY_LENGTH,
} from "../src/skill-finder";

const realFetch = globalThis.fetch;

/** Write a SKILL.md at <root>/<dir>/SKILL.md with the given frontmatter. */
function writeSkill(root: string, dir: string, frontmatter: string): string {
  const path = join(root, dir);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "SKILL.md"), `---\n${frontmatter}\n---\n# ${dir}\n`);
  return path;
}

const skill = (name: string, description: string) =>
  `name: ${name}\ndescription: ${description}`;

// ─── Frontmatter parsing ──────────────── ───

describe("parseSkillFrontmatter", () => {
  test("reads plain name and description", () => {
    const got = parseSkillFrontmatter(
      "---\nname: alpha\ndescription: does alpha things\n---\n# body\n",
    );
    expect(got).toEqual({ name: "alpha", description: "does alpha things" });
  });

  test("strips quotes around values", () => {
    const got = parseSkillFrontmatter(
      "---\nname: \"imagegen\"\ndescription: 'quoted'\n---\n",
    );
    expect(got).toEqual({ name: "imagegen", description: "quoted" });
  });

  test("folds block scalar descriptions onto one line", () => {
    const got = parseSkillFrontmatter(
      "---\nname: big\ndescription: >\n  first line\n  second line\n---\n",
    );
    expect(got?.description).toBe("first line second line");
  });

  test("handles CRLF frontmatter", () => {
    const got = parseSkillFrontmatter(
      "---\r\nname: crlf\r\ndescription: windows\r\n---\r\n",
    );
    expect(got).toEqual({ name: "crlf", description: "windows" });
  });

  test("returns null without frontmatter or without a name", () => {
    expect(parseSkillFrontmatter("# no frontmatter\n")).toBeNull();
    expect(
      parseSkillFrontmatter("---\ndescription: nameless\n---\n"),
    ).toBeNull();
  });

  test("tolerates a colon inside the description", () => {
    const got = parseSkillFrontmatter(
      "---\nname: colon\ndescription: use when: something happens\n---\n",
    );
    expect(got?.description).toBe("use when: something happens");
  });
});

// ─── Local scan ──────────────── ───

describe("scanLocalSkills", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-skills-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("finds skills nested a few levels deep", () => {
    const root = join(tmp, "skills");
    writeSkill(root, "alpha", skill("alpha", "first"));
    writeSkill(root, "nested/deep/beta", skill("beta", "second"));
    const found = scanLocalSkills([{ path: root, label: "fixture" }]);
    expect(found.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    expect(found[0].origin).toBe("fixture");
    expect(found[0].path.endsWith("SKILL.md")).toBe(true);
  });

  test("walks hidden directories such as .system", () => {
    const root = join(tmp, "skills");
    writeSkill(root, ".system/hidden", skill("hidden", "still indexed"));
    const found = scanLocalSkills([{ path: root, label: "fixture" }]);
    expect(found.map((s) => s.name)).toEqual(["hidden"]);
  });

  test("prunes node_modules and .git", () => {
    const root = join(tmp, "skills");
    writeSkill(root, "node_modules/evil", skill("evil", "not a skill"));
    writeSkill(root, ".git/evil", skill("evil-git", "not a skill"));
    writeSkill(root, "good", skill("good", "a real skill"));
    const found = scanLocalSkills([{ path: root, label: "fixture" }]);
    expect(found.map((s) => s.name)).toEqual(["good"]);
  });

  test("de-duplicates by name, first root wins", () => {
    const high = join(tmp, "high");
    const low = join(tmp, "low");
    writeSkill(high, "dup", skill("dup", "high priority"));
    writeSkill(low, "dup", skill("dup", "low priority"));
    writeSkill(low, "only-low", skill("only-low", "kept"));
    const found = scanLocalSkills([
      { path: high, label: "high" },
      { path: low, label: "low" },
    ]);
    const dup = found.find((s) => s.name === "dup");
    expect(dup?.description).toBe("high priority");
    expect(dup?.origin).toBe("high");
    expect(found.some((s) => s.name === "only-low")).toBe(true);
  });

  test("skips a missing root and a directory with no SKILL.md", () => {
    const root = join(tmp, "skills");
    mkdirSync(join(root, "empty"), { recursive: true });
    writeSkill(root, "real", skill("real", "found"));
    const found = scanLocalSkills([
      { path: join(tmp, "does-not-exist"), label: "missing" },
      { path: root, label: "fixture" },
    ]);
    expect(found.map((s) => s.name)).toEqual(["real"]);
  });

  test("collapses multi-line descriptions into one line", () => {
    const root = join(tmp, "skills");
    writeSkill(
      root,
      "multi",
      "name: multi\ndescription: >\n  one\n  two\n  three",
    );
    const found = scanLocalSkills([{ path: root, label: "fixture" }]);
    expect(found[0].description).toBe("one two three");
  });
});

// ─── Ranking ──────────────── ───

describe("rankLocalSkills", () => {
  const hits = [
    {
      name: "changelog",
      description: "writes changelogs",
      path: "/a",
      origin: "x",
    },
    {
      name: "changelog-helper",
      description: "assists",
      path: "/b",
      origin: "x",
    },
    {
      name: "release",
      description: "uses a changelog file",
      path: "/c",
      origin: "x",
    },
    { name: "unrelated", description: "nothing here", path: "/d", origin: "x" },
  ];

  test("orders exact name, prefix, substring, then description matches", () => {
    const got = rankLocalSkills(hits, "changelog");
    expect(got.map((s) => s.name)).toEqual([
      "changelog",
      "changelog-helper",
      "release",
    ]);
  });

  test("matches case-insensitively", () => {
    expect(rankLocalSkills(hits, "CHANGE").map((s) => s.name)).toEqual([
      "changelog",
      "changelog-helper",
      "release",
    ]);
  });

  test("honours the limit", () => {
    expect(rankLocalSkills(hits, "changelog", 2)).toHaveLength(2);
    expect(rankLocalSkills(hits, "changelog", 0)).toHaveLength(1);
  });

  test("returns nothing when no skill matches", () => {
    expect(rankLocalSkills(hits, "zzz")).toEqual([]);
  });
});

describe("clampLimit", () => {
  test("clamps into 1..100 and falls back on garbage", () => {
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(5000)).toBe(100);
    expect(clampLimit(Number.NaN)).toBe(100);
  });
});

// ─── searchLocalSkills / searchSkills ───

describe("searchLocalSkills", () => {
  let tmp: string;
  let roots: { path: string; label: string }[];
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-skills-"));
    const root = join(tmp, "skills");
    writeSkill(root, "testing", skill("testing", "write tests"));
    writeSkill(root, "release", skill("release", "cut releases"));
    roots = [{ path: root, label: "fixture" }];
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("returns the local search shape", () => {
    const got = searchLocalSkills("testing", { roots });
    expect(got.source).toBe("local");
    expect(got.query).toBe("testing");
    expect(got.count).toBe(1);
    expect(got.skills[0].name).toBe("testing");
    expect(got.skills[0].origin).toBe("fixture");
  });

  test("trims the query before matching", () => {
    expect(searchLocalSkills("  testing  ", { roots }).count).toBe(1);
  });

  test("an empty result is not an error", () => {
    const got = searchLocalSkills("nothing-matches", { roots });
    expect(got.count).toBe(0);
    expect(got.skills).toEqual([]);
  });

  test("rejects queries shorter than the minimum", () => {
    expect(() => searchLocalSkills("a", { roots })).toThrow(
      new RegExp(`${MIN_QUERY_LENGTH} characters`),
    );
  });

  test("reads GHFIND_SKILL_ROOTS when no roots are passed", () => {
    const previous = process.env.GHFIND_SKILL_ROOTS;
    process.env.GHFIND_SKILL_ROOTS = roots[0].path;
    try {
      expect(searchLocalSkills("testing").count).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.GHFIND_SKILL_ROOTS;
      else process.env.GHFIND_SKILL_ROOTS = previous;
    }
  });

  test("splits GHFIND_SKILL_ROOTS on the platform delimiter only", () => {
    const previous = process.env.GHFIND_SKILL_ROOTS;
    // A Windows root contains a drive colon; splitting on ":" would shred it,
    // so the override must use path.delimiter.
    process.env.GHFIND_SKILL_ROOTS = `${roots[0].path}${delimiter}${join(tmp, "missing")}`;
    try {
      const got = searchLocalSkills("testing");
      expect(got.count).toBe(1);
      expect(got.skills[0].origin).toBe(
        roots[0].path
          .replace(/\\/g, "/")
          .replace(homedir().replace(/\\/g, "/"), "~"),
      );
    } finally {
      if (previous === undefined) delete process.env.GHFIND_SKILL_ROOTS;
      else process.env.GHFIND_SKILL_ROOTS = previous;
    }
  });

  test("defaults to the four documented roots, highest priority first", () => {
    const previous = process.env.GHFIND_SKILL_ROOTS;
    delete process.env.GHFIND_SKILL_ROOTS;
    try {
      const roots = resolveSkillRoots("/work/project");
      expect(roots.map((r) => r.path)).toEqual([
        join(homedir(), ".codex", "skills"),
        join(homedir(), ".agents", "skills"),
        join("/work/project", ".codex", "skills"),
        join("/work/project", ".github", "skills"),
      ]);
    } finally {
      if (previous !== undefined) process.env.GHFIND_SKILL_ROOTS = previous;
    }
  });
});

describe("searchSkills", () => {
  let tmp: string;
  let roots: { path: string; label: string }[];
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ghfind-skills-"));
    const root = join(tmp, "skills");
    writeSkill(root, "testing", skill("testing", "write tests"));
    roots = [{ path: root, label: "fixture" }];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    rmSync(tmp, { recursive: true, force: true });
  });

  test("defaults to the local source", async () => {
    const got = await searchSkills("testing", { roots });
    expect(got.source).toBe("local");
    expect(got.count).toBe(1);
  });

  test("routes registry searches to skills.sh", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          query: "testing",
          skills: [
            {
              id: "acme/skills/tdd",
              source: "acme/skills",
              skillId: "tdd",
              name: "tdd",
              installs: 1234,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const got = await searchSkills("testing", { source: "registry", limit: 5 });
    expect(calledUrl).toContain("skills.sh/api/search");
    expect(calledUrl).toContain("q=testing");
    expect(calledUrl).toContain("limit=5");
    expect(got.source).toBe("registry");
    expect(got.count).toBe(1);
  });
});

// ─── Registry ──────────────── ───

const registryResponse = (skills: unknown[]) =>
  new Response(JSON.stringify({ query: "x", skills }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("searchRegistrySkills", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("normalizes hits into install commands and urls", async () => {
    globalThis.fetch = (async () =>
      registryResponse([
        {
          id: "vercel-labs/agent-skills/react",
          source: "vercel-labs/agent-skills",
          skillId: "react",
          name: "react",
          installs: 743406,
        },
      ])) as unknown as typeof fetch;

    const got = await searchRegistrySkills("react");
    expect(got.source).toBe("registry");
    expect(got.skills[0]).toEqual({
      id: "vercel-labs/agent-skills/react",
      source: "vercel-labs/agent-skills",
      skillId: "react",
      name: "react",
      installs: 743406,
      installCommand: "npx skills add vercel-labs/agent-skills@react",
      url: "https://skills.sh/vercel-labs/agent-skills/react",
    });
  });

  test("falls back to the skillId when no display name is given", async () => {
    globalThis.fetch = (async () =>
      registryResponse([
        { source: "acme/skills", skillId: "tdd", installs: 0 },
      ])) as unknown as typeof fetch;

    const got = await searchRegistrySkills("tdd");
    expect(got.skills[0].name).toBe("tdd");
    expect(got.skills[0].id).toBe("acme/skills/tdd");
    expect(got.skills[0].installs).toBe(0);
  });

  test("drops malformed hits instead of failing", async () => {
    globalThis.fetch = (async () =>
      registryResponse([
        null,
        { name: "nameless" },
        { source: "acme/skills", skillId: "kept" },
      ])) as unknown as typeof fetch;

    const got = await searchRegistrySkills("xy");
    expect(got.skills.map((s) => s.skillId)).toEqual(["kept"]);
  });

  test("encodes the query and applies the limit", async () => {
    let calledUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return registryResponse([]);
    }) as unknown as typeof fetch;

    await searchRegistrySkills("pr review", { limit: 3 });
    expect(calledUrl).toContain("q=pr%20review");
    expect(calledUrl).toContain("limit=3");
  });

  test("rejects short queries before any request", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return registryResponse([]);
    }) as unknown as typeof fetch;

    await expect(searchRegistrySkills("x")).rejects.toThrow(/at least 2/);
    expect(called).toBe(false);
  });

  test("reports HTTP failures with the status", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 400 })) as unknown as typeof fetch;

    await expect(searchRegistrySkills("react")).rejects.toThrow(/HTTP 400/);
  });

  test("reports network failures without leaking the raw error type", async () => {
    globalThis.fetch = (async () => {
      throw new Error("dns exploded");
    }) as unknown as typeof fetch;

    await expect(searchRegistrySkills("react")).rejects.toThrow(
      /Could not reach skills.sh: dns exploded/,
    );
  });

  test("rejects a non-JSON body", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>", { status: 200 })) as unknown as typeof fetch;

    await expect(searchRegistrySkills("react")).rejects.toThrow(/not JSON/);
  });

  test("tolerates a payload with no skills array", async () => {
    globalThis.fetch = (async () =>
      new Response("{}", { status: 200 })) as unknown as typeof fetch;

    const got = await searchRegistrySkills("react");
    expect(got.count).toBe(0);
  });
});

// ─── Formatting ──────────────── ───

describe("skill search formatting", () => {
  test("local text lists the name, origin and description", () => {
    const text = formatSkillSearchText({
      query: "t",
      source: "local",
      count: 1,
      skills: [
        {
          name: "tdd",
          description: "write tests first",
          path: "/x",
          origin: "~/.codex/skills",
        },
      ],
    });
    expect(text).toContain("tdd");
    expect(text).toContain("~/.codex/skills");
    expect(text).toContain("write tests first");
  });

  test("registry text includes installs and the install command", () => {
    const text = formatSkillSearchText({
      query: "t",
      source: "registry",
      count: 1,
      skills: [
        {
          id: "a/b/c",
          source: "a/b",
          skillId: "c",
          name: "c",
          installs: 1234,
          installCommand: "npx skills add a/b@c",
          url: "https://skills.sh/a/b/c",
        },
      ],
    });
    expect(text).toContain("1,234 installs");
    expect(text).toContain("npx skills add a/b@c");
  });

  test("empty results explain the next step, per source", () => {
    expect(
      formatSkillSearchText({
        query: "t",
        source: "local",
        count: 0,
        skills: [],
      }),
    ).toContain("--remote");
    expect(
      formatSkillSearchText({
        query: "t",
        source: "registry",
        count: 0,
        skills: [],
      }),
    ).toContain("No skills.sh entries");
  });

  test("names output is one skill per line", () => {
    const names = formatSkillSearchNames({
      query: "t",
      source: "local",
      count: 2,
      skills: [
        { name: "a", description: "", path: "/a", origin: "x" },
        { name: "b", description: "", path: "/b", origin: "x" },
      ],
    });
    expect(names).toBe("a\nb");
  });

  test("json output round-trips", () => {
    const result = {
      query: "t",
      source: "local" as const,
      count: 1,
      skills: [{ name: "a", description: "d", path: "/a", origin: "x" }],
    };
    expect(JSON.parse(formatSkillSearchJson(result))).toEqual(result);
  });

  test("long descriptions are clipped to one readable line", () => {
    const text = formatSkillSearchText({
      query: "t",
      source: "local",
      count: 1,
      skills: [
        { name: "a", description: "x".repeat(300), path: "/a", origin: "x" },
      ],
    });
    // The line carries the two-space indent; the description itself is clipped.
    expect(text.split("\n")[1].trim().length).toBeLessThanOrEqual(100);
    expect(text).toContain("\u2026");
  });
});
