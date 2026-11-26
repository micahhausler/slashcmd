import { vi } from "vitest";
import type { Octokit } from "../src/types";

export function fakeOctokit(overrides: Record<string, Record<string, unknown>> = {}) {
  const rest = {
    pulls: { get: vi.fn(), listCommits: vi.fn() },
    repos: { getBranch: vi.fn(), compareCommitsWithBasehead: vi.fn(), getCollaboratorPermissionLevel: vi.fn() },
    git: { createCommit: vi.fn() },
    apps: {
      getRepoInstallation: vi.fn(),
      createInstallationAccessToken: vi.fn(),
      revokeInstallationAccessToken: vi.fn(),
    },
    reactions: { createForIssueComment: vi.fn() },
    issues: { createComment: vi.fn() },
  };
  for (const [ns, fns] of Object.entries(overrides)) Object.assign((rest as Record<string, object>)[ns], fns);
  const paginate = vi.fn(
    async (fn: (p: unknown) => Promise<{ data: unknown }>, params: unknown) => (await fn(params)).data,
  );
  const graphql = vi.fn(() => Promise.resolve({}));
  return { rest, paginate, graphql, octokit: { rest, paginate, graphql } as unknown as Octokit };
}

export const commit = (sha: string, parents: string[], extra: Record<string, unknown> = {}) => ({
  sha,
  parents: parents.map((p) => ({ sha: p })),
  commit: {
    message: `message ${sha}`,
    tree: { sha: `tree-${sha}` },
    author: { name: `author ${sha}`, email: `${sha}@example.com`, date: `2026-01-01T00:00:0${sha.length}Z` },
    ...extra,
  },
});
