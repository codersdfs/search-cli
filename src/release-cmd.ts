/**
 * release-cmd.ts — dispatch the GitHub Actions Release workflow.
 *
 * `ghfind release run --tag vX.Y.Z` is the CLI front-end to
 * `gh workflow run release --ref vX.Y.Z`: it asks GitHub to dispatch the
 * Release workflow for a tag, which re-runs the CI gate, builds the standalone
 * binaries, attaches them to the GitHub Release and publishes to npm. The
 * workflow file only declares `workflow_dispatch`; this command is the first
 * ghfind surface that triggers it.
 */

const OWNER = "codersdfs";
const REPO = "search-cli";
const WORKFLOW_FILE = "release.yml";

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]*)?$/;

export function isReleaseTag(tag: string): boolean {
  return RELEASE_TAG_PATTERN.test(tag);
}

export interface ReleaseWorkflowOptions {
  tag: string;
  dryRun?: boolean;
  fetch?: typeof fetch;
  token?: string;
}

export interface ReleaseWorkflowResult {
  ok: boolean;
  dryRun: boolean;
  tag: string;
  workflow: string;
  runUrl?: string;
  error?: string;
}

export function releaseDispatchUrl(
  owner: string = OWNER,
  repo: string = REPO,
  workflow: string = WORKFLOW_FILE,
): string {
  return `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
}

export async function runReleaseWorkflow(
  opts: ReleaseWorkflowOptions,
): Promise<ReleaseWorkflowResult> {
  const { tag, dryRun, fetch: fetchImpl = fetch, token } = opts;
  const result: ReleaseWorkflowResult = {
    ok: false,
    dryRun: dryRun === true,
    tag,
    workflow: "Release",
  };
  if (dryRun) {
    return { ...result, ok: true };
  }
  const response = await fetchImpl(releaseDispatchUrl(), {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ref: tag }),
  });
  if (response.status === 204) {
    return {
      ...result,
      ok: true,
      runUrl: response.headers.get("Location") ?? undefined,
    };
  }
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return {
    ...result,
    ok: false,
    error: body?.message
      ? `GitHub Actions dispatch failed: ${body.message}`
      : `GitHub Actions dispatch failed (HTTP ${response.status})`,
  };
}
