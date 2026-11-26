import { describe, expect, it } from "vitest";
import { firstParentChain, reachable, squash, updateRefsMutation } from "../src/squash";
import { Refusal } from "../src/types";
import { commit, fakeOctokit } from "./helpers";

type C = ReturnType<typeof commit>;
const index = (commits: C[]) => new Map(commits.map((c) => [c.sha, c]));
const shas = (commits: C[]) => commits.map((c) => c.sha);

describe("firstParentChain", () => {
  it("walks a linear branch", () => {
    const m = index([commit("a", ["base"]), commit("b", ["a"]), commit("c", ["b"])]);
    expect(shas(firstParentChain("c", m))).toEqual(["c", "b", "a"]);
  });

  it("follows first parents past merges from the base branch", () => {
    const m = index([commit("a", ["base"]), commit("m", ["a", "main2"]), commit("b", ["m"])]);
    expect(shas(firstParentChain("b", m))).toEqual(["b", "m", "a"]);
  });

  it("returns one commit for a single-commit branch", () => {
    expect(shas(firstParentChain("a", index([commit("a", ["base"])])))).toEqual(["a"]);
  });

  it("returns nothing when the head is missing", () => {
    expect(firstParentChain("x", index([commit("a", ["base"])]))).toEqual([]);
  });
});

describe("reachable", () => {
  it("ignores commits newer than the head", () => {
    const m = index([commit("a", ["base"]), commit("b", ["a"]), commit("c", ["b"])]);
    expect([...reachable("b", m)].sort()).toEqual(["a", "b"]);
  });
});

const repo = { owner: "o", repo: "r" };

function pr(overrides: Record<string, unknown> = {}) {
  return {
    state: "open",
    head: { ref: "feature", sha: "c", repo: { full_name: "o/r" } },
    base: { ref: "main", repo: { full_name: "o/r", default_branch: "main", node_id: "R_node" } },
    commits: 3,
    ...overrides,
  };
}

function setup({
  pull = pr(),
  commits = [commit("a", ["base"]), commit("b", ["a"]), commit("c", ["b"])],
  protectedBranch = false,
  mergeBase = "base",
  baseTree = "tree-base",
} = {}) {
  const gh = fakeOctokit();
  const app = fakeOctokit();
  gh.rest.pulls.get.mockResolvedValue({ data: pull });
  gh.rest.pulls.listCommits.mockResolvedValue({ data: commits });
  gh.rest.repos.getBranch.mockResolvedValue({ data: { protected: protectedBranch } });
  gh.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
    data: { merge_base_commit: { sha: mergeBase, commit: { tree: { sha: baseTree } } } },
  });
  app.rest.git.createCommit.mockResolvedValue({ data: { sha: "0123456789abcdef" } });
  return { gh, app, run: () => squash({ ...repo, number: 7, gh: gh.octokit, app: app.octokit }) };
}

describe("squash", () => {
  it("creates one commit from the first commit's message and author on the head tree, then updates the ref with a lease", async () => {
    const { gh, app, run } = setup();
    await expect(run()).resolves.toBe("squashed 3 commits into 0123456");
    expect(gh.rest.pulls.get).toHaveBeenCalledWith({ owner: "o", repo: "r", pull_number: 7 });
    expect(gh.rest.repos.getBranch).toHaveBeenCalledWith({ owner: "o", repo: "r", branch: "feature" });
    expect(gh.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      basehead: "main...c",
      per_page: 1,
    });
    expect(app.rest.git.createCommit).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      message: "message a",
      tree: "tree-c",
      parents: ["base"],
      author: { name: "author a", email: "a@example.com", date: "2026-01-01T00:00:01Z" },
    });
    expect(app.graphql).toHaveBeenCalledWith(updateRefsMutation, {
      input: {
        repositoryId: "R_node",
        refUpdates: [{ name: "refs/heads/feature", beforeOid: "c", afterOid: "0123456789abcdef", force: true }],
      },
    });
  });

  it("uses the App token only for the commit and the ref update", async () => {
    const { app, run } = setup();
    await run();
    for (const ns of ["pulls", "repos", "apps", "reactions", "issues"] as const) {
      for (const fn of Object.values(app.rest[ns])) expect(fn).not.toHaveBeenCalled();
    }
    expect(app.paginate).not.toHaveBeenCalled();
  });

  it("squashes onto the current merge base when the branch merged the base branch in", async () => {
    const { app, run } = setup({
      commits: [commit("a", ["base"]), commit("m", ["a", "main2"]), commit("c", ["m"])],
      mergeBase: "main2",
    });
    await expect(run()).resolves.toBe("squashed 3 commits into 0123456");
    expect(app.rest.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ message: "message a", tree: "tree-c", parents: ["main2"] }),
    );
  });

  it("ignores commits newer than the head it read", async () => {
    const { app, run } = setup({
      commits: [commit("a", ["base"]), commit("b", ["a"]), commit("c", ["b"]), commit("d", ["c"])],
    });
    await expect(run()).resolves.toBe("squashed 3 commits into 0123456");
    expect(app.rest.git.createCommit).toHaveBeenCalledWith(expect.objectContaining({ tree: "tree-c" }));
    expect(app.graphql).toHaveBeenCalledWith(
      updateRefsMutation,
      expect.objectContaining({
        input: expect.objectContaining({ refUpdates: [expect.objectContaining({ beforeOid: "c" })] }) as unknown,
      }),
    );
  });

  it("leaves the author to GitHub when the first commit has none", async () => {
    const { app, run } = setup({
      commits: [commit("a", ["base"], { author: null }), commit("b", ["a"]), commit("c", ["b"])],
    });
    await run();
    expect(app.rest.git.createCommit).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      message: "message a",
      tree: "tree-c",
      parents: ["base"],
    });
  });

  it("does nothing for a single commit", async () => {
    const { app, run } = setup({
      pull: pr({ head: { ref: "feature", sha: "a", repo: { full_name: "o/r" } }, commits: 1 }),
      commits: [commit("a", ["base"])],
    });
    await expect(run()).resolves.toBe("already one commit");
    expect(app.rest.git.createCommit).not.toHaveBeenCalled();
    expect(app.graphql).not.toHaveBeenCalled();
  });

  it.each([
    ["a closed pull request", { pull: pr({ state: "closed" }) }, /not open/],
    ["a fork", { pull: pr({ head: { ref: "feature", sha: "c", repo: { full_name: "fork/r" } } }) }, /forks/],
    ["a deleted head repository", { pull: pr({ head: { ref: "feature", sha: "c", repo: null } }) }, /forks/],
    [
      "the default branch",
      { pull: pr({ head: { ref: "main", sha: "c", repo: { full_name: "o/r" } } }) },
      /default branch/,
    ],
    ["a protected branch", { protectedBranch: true }, /protected/],
    ["a net-empty diff", { baseTree: "tree-c" }, /empty/],
    ["too many commits", { pull: pr({ commits: 251 }) }, /at most 250/],
    [
      "a head that merges the branch into a base commit",
      { commits: [commit("a", ["base"]), commit("b", ["a"]), commit("c", ["main2", "b"])] },
      /is a merge/,
    ],
    [
      "a first-parent history that skips some of the pull request's commits",
      { commits: [commit("x", ["base"]), commit("a", ["base"]), commit("b", ["a", "x"]), commit("c", ["b"])] },
      /aren't on its first-parent history/,
    ],
  ])("refuses %s", async (_name, opts, message) => {
    const { app, run } = setup(opts);
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Refusal);
    expect((err as Error).message).toMatch(message);
    expect(app.rest.git.createCommit).not.toHaveBeenCalled();
    expect(app.graphql).not.toHaveBeenCalled();
  });

  it("explains a missing workflows permission", async () => {
    const { app, run } = setup();
    app.graphql.mockRejectedValue(
      new Error(
        "refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission",
      ),
    );
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Refusal);
    expect((err as Error).message).toMatch(/can't update branches that change \.github\/workflows/);
  });

  it("passes other errors that mention workflows through unchanged", async () => {
    const { app, run } = setup();
    app.graphql.mockRejectedValue(new Error("workflow run quota exceeded"));
    const err = await run().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(Refusal);
    expect((err as Error).message).toBe("workflow run quota exceeded");
  });
});
