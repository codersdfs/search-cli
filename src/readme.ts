/**
 * README retrieval.
 *
 * A repository's README can live at one of three URLs, and the first guess
 * ("main") 404s often enough that awaiting the candidates one at a time
 * triples the time before any text appears. All three are therefore fired at
 * once and the first *usable* response wins.
 */
import { readmeBaseUrl } from "./image-loader";

export interface Readme {
  /** The raw README markdown (or reStructuredText). */
  text: string;
  /**
   * Where the README came from. Its own URL doubles as the base for resolving
   * relative image paths, so it must match the branch that actually served.
   */
  sourceUrl: string;
}

/**
 * Candidate README locations, most likely first.
 */
const CANDIDATES: ReadonlyArray<readonly [string, string]> = [
  ["main", "README.md"],
  ["master", "README.md"],
  ["main", "README.rst"],
];

export async function fetchReadme(
  owner: string,
  repo: string,
  opts: { token?: string; fetchImpl?: typeof fetch } = {},
): Promise<Readme | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "User-Agent": "ghfind/1.0" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const attempts = CANDIDATES.map(async ([branch, file]) => {
    const url = readmeBaseUrl(owner, repo, branch, file);
    const res = await fetchImpl(url, { headers });
    // Reject rather than resolve with null: Promise.any settles on the first
    // *fulfilled* promise, so a 404 that resolved would beat the real README.
    if (!res.ok) throw new Error(`no readme at ${url}`);
    return { text: await res.text(), sourceUrl: url } satisfies Readme;
  });

  try {
    return await Promise.any(attempts);
  } catch {
    // AggregateError: every candidate failed.
    return null;
  }
}
