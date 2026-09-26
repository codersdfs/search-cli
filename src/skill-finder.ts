/**
 * skill-finder.ts — keyword search over agent skills, from two sources.
 *
 * Agents start a session not knowing which skills this machine has, and the
 * public skills ecosystem is searched through a web page. This module gives
 * both a single seam:
 *
 *   source      where results come from                          transport
 *   ─────────── ──────────────────────────────────────────────── ─────────────
 *   local       SKILL.md files installed under the four roots    filesystem
 *   registry    skills.sh public ecosystem                      HTTPS (public)
 *
 * Everything here is read-only: nothing is downloaded, installed, or written.
 * Registry results carry the `npx skills add` command for a human or agent to
 * run deliberately.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────

/** Where an installed skill was found, and what it says about itself. */
export interface LocalSkillHit {
  /** The skill's frontmatter `name`. Also the `ghfind skill <name>` selector. */
  name: string;
  /** One-line summary from frontmatter (newlines collapsed). */
  description: string;
  /** Absolute path to the SKILL.md that won de-duplication. */
  path: string;
  /** Human-readable root the skill came from (home abbreviated to `~`). */
  origin: string;
}

/** One skill from the public skills.sh ecosystem. */
export interface RegistrySkillHit {
  /** `owner/repo/skillId` — the unique ecosystem id. */
  id: string;
  /** Source repository, `owner/repo`. */
  source: string;
  /** Skill id within that repository. */
  skillId: string;
  /** Display name (the ecosystem sometimes supplies a title-case name). */
  name: string;
  /** Install count, the ecosystem's popularity signal. */
  installs: number;
  /** Command a human or agent can run to install it. */
  installCommand: string;
  /** Page for the skill on skills.sh. */
  url: string;
}

export interface LocalSkillSearchResult {
  query: string;
  source: "local";
  count: number;
  skills: LocalSkillHit[];
}

export interface RegistrySkillSearchResult {
  query: string;
  source: "registry";
  count: number;
  skills: RegistrySkillHit[];
}

/** A skill search outcome, discriminated by `source`. */
export type SkillSearchResult =
  LocalSkillSearchResult | RegistrySkillSearchResult;

export type SkillSource = "local" | "registry";

/** The skills.sh search endpoint (public, no auth). */
export const REGISTRY_SEARCH_ENDPOINT = "https://skills.sh/api/search";

/** Shortest accepted query. skills.sh rejects anything shorter with HTTP 400. */
export const MIN_QUERY_LENGTH = 2;

/** Result cap, applied to both sources. */
export const MAX_SKILL_RESULTS = 100;

// ─── Local roots ──────────────────────────────────────────────────────────

/** One scan root: where it is, and the label results carry. */
interface SkillRoot {
  path: string;
  label: string;
}

/** Abbreviate a path for display: home becomes `~`, separators become `/`. */
function displayPath(path: string): string {
  const home = homedir();
  const normalized = path.replace(/\\/g, "/");
  const homeNorm = home.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized === homeNorm) return "~";
  if (normalized.startsWith(`${homeNorm}/`)) {
    return `~${normalized.slice(homeNorm.length)}`;
  }
  return normalized;
}

/**
 * The four roots scanned for installed skills, highest priority first.
 *
 * User-level roots outrank project-level ones, and `~/.codex/skills` outranks
 * `~/.agents/skills`: the two overlap heavily on real machines, and the
 * Codex-managed copy is the one its own tooling reads.
 */
export function defaultSkillRoots(cwd: string = process.cwd()): string[] {
  const home = homedir();
  return [
    join(home, ".codex", "skills"),
    join(home, ".agents", "skills"),
    join(cwd, ".codex", "skills"),
    join(cwd, ".github", "skills"),
  ];
}

/**
 * Scan roots in priority order. `GHFIND_SKILL_ROOTS` overrides the defaults —
 * the seam tests and the MCP tool use it to point at a fixture directory
 * instead of the real machine. It is split on the platform delimiter only
 * (`;` on Windows, `:` elsewhere), so a Windows drive letter survives.
 */
export function resolveSkillRoots(cwd: string = process.cwd()): SkillRoot[] {
  const override = process.env.GHFIND_SKILL_ROOTS;
  const paths = override?.trim()
    ? override
        .split(delimiter)
        .filter((p) => p.trim())
        .map((p) => p.trim())
    : defaultSkillRoots(cwd);
  return paths.map((path) => ({ path, label: displayPath(path) }));
}

// ─── Frontmatter ──────────────────────────────────────────────────────────

/** Directories never worth walking into. Hidden dirs ARE walked (`.system`). */
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/** Cap on directory depth, so a symlink loop cannot hang a scan. */
const MAX_DEPTH = 4;

/** Strip one layer of matching quotes from a frontmatter scalar. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Read `name` and `description` out of a SKILL.md frontmatter block.
 *
 * Handles the three shapes real skills use: plain scalars, quoted scalars
 * (`name: "imagegen"`), and folded/literal blocks (`description: >` followed
 * by indented lines). Returns null when there is no frontmatter block.
 */
export function parseSkillFrontmatter(
  text: string,
): { name: string; description: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const field = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!field) continue;
    const key = field[1].toLowerCase();
    const inline = field[2].trim();
    if (inline === ">" || inline === "|" || /^[>|][-+]?$/.test(inline)) {
      // Block scalar: gather the following more-indented lines.
      const literal = inline.startsWith("|");
      const parts: string[] = [];
      while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
        parts.push(lines[++i].trim());
      }
      fields[key] = literal ? parts.join("\n") : parts.join(" ");
    } else {
      fields[key] = unquote(inline);
    }
  }
  const name = fields.name ?? "";
  if (!name) return null;
  return { name, description: fields.description ?? "" };
}

// ─── Local scan ───────────────────────────────────────────────────────────

/**
 * Walk the roots and collect every readable SKILL.md, de-duplicated by name.
 *
 * The first root to claim a name wins; within a root the shallowest path wins
 * (breadth-first order). Unreadable directories and malformed files are skipped
 * rather than failing the whole scan — a scan is best-effort by nature.
 */
export function scanLocalSkills(
  roots: SkillRoot[] = resolveSkillRoots(),
): LocalSkillHit[] {
  const byName = new Map<string, LocalSkillHit>();
  for (const root of roots) {
    for (const dir of walkDirs(root.path)) {
      const entries = listDir(dir);
      if (!entries) continue;
      if (!entries.some((e) => e.isFile() && e.name === "SKILL.md")) continue;
      const file = join(dir, "SKILL.md");
      try {
        const parsed = parseSkillFrontmatter(readFileSync(file, "utf-8"));
        if (!parsed || byName.has(parsed.name)) continue;
        byName.set(parsed.name, {
          name: parsed.name,
          description: parsed.description.replace(/\s+/g, " ").trim(),
          path: file,
          origin: root.label,
        });
      } catch {
        // unreadable file — skip it, the rest of the scan still stands
      }
    }
  }
  return [...byName.values()];
}

/** Directory entries, or null when the directory is missing or unreadable. */
function listDir(dir: string): Dirent[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true }) as Dirent[];
  } catch {
    return null;
  }
}

/**
 * Directories under `root`, breadth-first and depth-capped so a symlink loop
 * cannot hang a scan. `node_modules` and `.git` are pruned; other hidden
 * directories (e.g. `.system`) are walked.
 */
function* walkDirs(root: string): Generator<string> {
  const queue: Array<[string, number]> = [[root, 0]];
  while (queue.length > 0) {
    const [dir, depth] = queue.shift() as [string, number];
    const entries = listDir(dir);
    if (!entries) continue;
    yield dir;
    if (depth >= MAX_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      queue.push([join(dir, entry.name), depth + 1]);
    }
  }
}

// ─── Ranking ──────────────────────────────────────────────────────────────

/** Match tiers, best first: exact name, name prefix, name, description. */
function localMatchTier(hit: LocalSkillHit, needle: string): number | null {
  const name = hit.name.toLowerCase();
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (hit.description.toLowerCase().includes(needle)) return 3;
  return null;
}

/** Filter + rank local skills for a query. */
export function rankLocalSkills(
  hits: LocalSkillHit[],
  query: string,
  limit: number = MAX_SKILL_RESULTS,
): LocalSkillHit[] {
  const needle = query.trim().toLowerCase();
  return hits
    .map((hit) => ({ hit, tier: localMatchTier(hit, needle) }))
    .filter(
      (entry): entry is { hit: LocalSkillHit; tier: number } =>
        entry.tier !== null,
    )
    .sort((a, b) => a.tier - b.tier || a.hit.name.localeCompare(b.hit.name))
    .slice(0, clampLimit(limit))
    .map((entry) => entry.hit);
}

/** Clamp a result limit into 1..MAX_SKILL_RESULTS. */
export function clampLimit(limit: number): number {
  const n = Math.trunc(Number(limit));
  if (!Number.isFinite(n)) return MAX_SKILL_RESULTS;
  return Math.min(Math.max(n, 1), MAX_SKILL_RESULTS);
}

/** Throw for queries both sources reject, before any work is done. */
export function assertSearchableQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    throw new Error(
      `Query must be at least ${MIN_QUERY_LENGTH} characters (got "${trimmed}").`,
    );
  }
  return trimmed;
}

// ─── Search entry points ──────────────────────────────────────────────────

/** Search skills installed on this machine. */
export function searchLocalSkills(
  query: string,
  opts: { limit?: number; roots?: SkillRoot[] } = {},
): LocalSkillSearchResult {
  const trimmed = assertSearchableQuery(query);
  const skills = rankLocalSkills(
    scanLocalSkills(opts.roots ?? resolveSkillRoots()),
    trimmed,
    opts.limit ?? MAX_SKILL_RESULTS,
  );
  return { query: trimmed, source: "local", count: skills.length, skills };
}

/** Normalize one skills.sh search result. */
function normalizeRegistrySkill(raw: unknown): RegistrySkillHit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const source = typeof obj.source === "string" ? obj.source : "";
  const skillId = typeof obj.skillId === "string" ? obj.skillId : "";
  if (!source || !skillId) return null;
  const name =
    typeof obj.name === "string" && obj.name.trim() ? obj.name : skillId;
  const installs = typeof obj.installs === "number" ? obj.installs : 0;
  const id =
    typeof obj.id === "string" && obj.id ? obj.id : `${source}/${skillId}`;
  return {
    id,
    source,
    skillId,
    name,
    installs,
    installCommand: `npx skills add ${source}@${skillId}`,
    url: `https://skills.sh/${source}/${skillId}`,
  };
}

/**
 * Search the public skills.sh ecosystem.
 *
 * Read-only: results carry the command to install, never an install. Network
 * and protocol failures surface as plain Errors with a user-facing message.
 */
export async function searchRegistrySkills(
  query: string,
  opts: { limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<RegistrySkillSearchResult> {
  const trimmed = assertSearchableQuery(query);
  const limit = clampLimit(opts.limit ?? MAX_SKILL_RESULTS);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${REGISTRY_SEARCH_ENDPOINT}?q=${encodeURIComponent(trimmed)}&limit=${limit}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "ghfind/1.0" },
    });
  } catch (err) {
    throw new Error(
      `Could not reach skills.sh: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new Error(
      `skills.sh returned HTTP ${res.status} for "${trimmed}". Retry, or search locally with --local.`,
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new Error("skills.sh returned a response that was not JSON.");
  }
  const items = (payload as { skills?: unknown[] })?.skills ?? [];
  const skills = items
    .map(normalizeRegistrySkill)
    .filter((s): s is RegistrySkillHit => s !== null)
    .slice(0, limit);
  return { query: trimmed, source: "registry", count: skills.length, skills };
}

/** Search skills by source — the single entry point CLI and MCP share. */
export async function searchSkills(
  query: string,
  opts: {
    source?: SkillSource;
    limit?: number;
    roots?: SkillRoot[];
    fetchImpl?: typeof fetch;
  } = {},
): Promise<SkillSearchResult> {
  if ((opts.source ?? "local") === "registry") {
    return searchRegistrySkills(query, opts);
  }
  return searchLocalSkills(query, opts);
}

// ─── Formatting ───────────────────────────────────────────────────────────

/** JSON payload for either source (the shape agents should parse). */
export function formatSkillSearchJson(result: SkillSearchResult): string {
  return JSON.stringify(result, null, 2);
}

/** Trim a description to one readable line for text output. */
function shortDescription(description: string, width = 100): string {
  if (description.length <= width) return description;
  return `${description.slice(0, width - 1).trimEnd()}…`;
}

/** Human/agent-readable text for a search result. */
export function formatSkillSearchText(result: SkillSearchResult): string {
  if (result.count === 0) {
    return result.source === "local"
      ? `No installed skills match "${result.query}". Try --remote to search the skills.sh ecosystem.`
      : `No skills.sh entries match "${result.query}".`;
  }
  if (result.source === "local") {
    return result.skills
      .map(
        (s) => `${s.name}  (${s.origin})\n  ${shortDescription(s.description)}`,
      )
      .join("\n");
  }
  return result.skills
    .map(
      (s) =>
        `${s.name}  ${s.installs.toLocaleString()} installs  [${s.source}]\n  ${s.installCommand}`,
    )
    .join("\n");
}

/** Names only — the pipe-friendly form (`ghfind skill search x --names`). */
export function formatSkillSearchNames(result: SkillSearchResult): string {
  return result.skills.map((s) => s.name).join("\n");
}
