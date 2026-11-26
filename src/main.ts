import * as core from "@actions/core";
import { withAppToken } from "./appToken";
import { authorize, getPermission } from "./authorize";
import { parseCommand, type Command } from "./parse";
import { commentFailure, react, summarize } from "./report";
import { squash } from "./squash";
import type { CommandContext, OctokitFactory, Repo } from "./types";
import { errorMessage, Refusal } from "./types";

export interface Inputs {
  appClientId: string;
  appKey: string;
  allowedUsers: string;
  githubToken: string;
}

export interface CommentPayload {
  action?: string;
  issue?: { number: number; pull_request?: unknown };
  comment?: { id: number; body?: string; user: { login: string } };
}

export interface Event extends Repo {
  eventName: string;
  payload: CommentPayload;
  runUrl: string;
}

const handlers: Record<Command, (c: CommandContext) => Promise<string>> = { squash };

export async function run(ev: Event, inputs: Inputs, octokit: OctokitFactory): Promise<void> {
  if (inputs.appKey) core.setSecret(inputs.appKey);
  const { action, issue, comment } = ev.payload;
  if (ev.eventName !== "issue_comment" || action !== "created" || !issue?.pull_request || !comment) return;
  const command = parseCommand(comment.body ?? "");
  if (!command) return;

  const repo: Repo = { owner: ev.owner, repo: ev.repo };
  const login = comment.user.login;
  const gh = octokit(inputs.githubToken);
  const decision = authorize(login, await getPermission(gh, repo, login), inputs.allowedUsers);
  if (!decision.ok) {
    core.notice(`ignoring /${command}: ${decision.reason}`);
    return;
  }

  const commentId = comment.id;
  const number = issue.number;
  await react(gh, repo, commentId, "eyes");
  try {
    if (!inputs.appClientId || !inputs.appKey) throw new Error("app-client-id and app-key are required");
    const message = await withAppToken(
      { ...repo, clientId: inputs.appClientId, privateKey: inputs.appKey, octokit },
      (app) => handlers[command]({ ...repo, gh, app, number }),
    );
    await react(gh, repo, commentId, "+1");
    await summarize(command, message);
  } catch (e) {
    core.setFailed(`/${command} failed: ${errorMessage(e)}`);
    await react(gh, repo, commentId, "-1");
    await commentFailure(gh, repo, number, command, ev.runUrl, e instanceof Refusal ? e.message : undefined);
  }
}
