import * as core from "@actions/core";
import type { Octokit, Repo } from "./types";
import { errorMessage } from "./types";

export type Reaction = "eyes" | "+1" | "-1";

export async function react(gh: Octokit, { owner, repo }: Repo, commentId: number, content: Reaction): Promise<void> {
  try {
    await gh.rest.reactions.createForIssueComment({ owner, repo, comment_id: commentId, content });
  } catch (e) {
    core.warning(`adding ${content} reaction failed: ${errorMessage(e)}`);
  }
}

export async function commentFailure(
  gh: Octokit,
  { owner, repo }: Repo,
  number: number,
  command: string,
  runUrl: string,
  reason?: string,
): Promise<void> {
  try {
    await gh.rest.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body: reason ? `\`/${command}\` failed: ${reason}\n\n${runUrl}` : `\`/${command}\` failed: ${runUrl}`,
    });
  } catch (e) {
    core.warning(`commenting on #${number} failed: ${errorMessage(e)}`);
  }
}

export async function summarize(command: string, message: string): Promise<void> {
  core.info(`/${command}: ${message}`);
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await core.summary.addRaw(`\`/${command}\`: ${message}`, true).write();
}
