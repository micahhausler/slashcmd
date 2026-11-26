import type { CommandContext } from "./types";
import { errorMessage, Refusal } from "./types";

export const maxCommits = 250;

export interface CommitNode {
  sha: string;
  parents: { sha: string }[];
}

// head first
export function firstParentChain<C extends CommitNode>(headSha: string, bySha: Map<string, C>): C[] {
  const chain: C[] = [];
  for (let c = bySha.get(headSha); c; c = bySha.get(c.parents[0]?.sha ?? "")) chain.push(c);
  return chain;
}

export function reachable<C extends CommitNode>(headSha: string, bySha: Map<string, C>): Set<string> {
  const seen = new Set<string>();
  const stack = [headSha];
  for (let sha = stack.pop(); sha !== undefined; sha = stack.pop()) {
    const c = bySha.get(sha);
    if (!c || seen.has(sha)) continue;
    seen.add(sha);
    stack.push(...c.parents.map((p) => p.sha));
  }
  return seen;
}

export const updateRefsMutation = `mutation($input: UpdateRefsInput!) {
  updateRefs(input: $input) { clientMutationId }
}`;

const workflowsPermission = /without `workflows` permission/;

export async function squash({ gh, app, owner, repo, number }: CommandContext): Promise<string> {
  const { data: pr } = await gh.rest.pulls.get({ owner, repo, pull_number: number });
  if (pr.state !== "open") throw new Refusal("the pull request is not open");
  if (!pr.head.repo || pr.head.repo.full_name.toLowerCase() !== pr.base.repo.full_name.toLowerCase()) {
    throw new Refusal("/squash works only on branches in this repository, not forks");
  }
  const headRef = pr.head.ref;
  const headSha = pr.head.sha;
  if (headRef === pr.base.repo.default_branch) {
    throw new Refusal(`${headRef} is the default branch`);
  }
  if (pr.commits > maxCommits) {
    throw new Refusal(`the pull request has ${pr.commits} commits; /squash handles at most ${maxCommits}`);
  }

  const { data: branch } = await gh.rest.repos.getBranch({ owner, repo, branch: headRef });
  if (branch.protected) throw new Refusal(`${headRef} is a protected branch`);

  const { data: compare } = await gh.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${pr.base.ref}...${headSha}`,
    per_page: 1,
  });
  const mergeBase = compare.merge_base_commit;

  const commits = await gh.paginate(gh.rest.pulls.listCommits, { owner, repo, pull_number: number, per_page: 100 });
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const chain = firstParentChain(headSha, bySha);
  if (chain.length === 0) throw new Error(`head ${headSha} is not among the pull request's commits`);
  const first = chain[chain.length - 1];
  if (first.parents.length > 1) {
    throw new Refusal(`the oldest commit on the branch's first-parent history, ${first.sha.slice(0, 7)}, is a merge`);
  }
  if (reachable(headSha, bySha).size !== chain.length) {
    throw new Refusal("the branch merges commits that aren't on its first-parent history");
  }
  if (chain.length === 1) return "already one commit";

  const tree = chain[0].commit.tree.sha;
  if (tree === mergeBase.commit.tree.sha) {
    throw new Refusal(`the pull request's net diff against ${pr.base.ref} is empty`);
  }

  const a = first.commit.author;
  try {
    const { data: created } = await app.rest.git.createCommit({
      owner,
      repo,
      message: first.commit.message,
      tree,
      parents: [mergeBase.sha],
      ...(a?.name && a.email ? { author: { name: a.name, email: a.email, ...(a.date ? { date: a.date } : {}) } } : {}),
    });
    await app.graphql(updateRefsMutation, {
      input: {
        repositoryId: pr.base.repo.node_id,
        refUpdates: [{ name: `refs/heads/${headRef}`, beforeOid: headSha, afterOid: created.sha, force: true }],
      },
    });
    return `squashed ${chain.length} commits into ${created.sha.slice(0, 7)}`;
  } catch (e) {
    if (workflowsPermission.test(errorMessage(e))) {
      throw new Refusal("the App can't update branches that change .github/workflows");
    }
    throw e;
  }
}
