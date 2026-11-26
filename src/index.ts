import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { run, type CommentPayload } from "./main";
import { errorMessage } from "./types";

const { owner, repo } = context.repo;
run(
  {
    eventName: context.eventName,
    payload: context.payload as CommentPayload,
    owner,
    repo,
    runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
  },
  {
    appClientId: core.getInput("app-client-id"),
    appKey: core.getInput("app-key"),
    allowedUsers: core.getInput("allowed-users"),
    githubToken: core.getInput("github-token"),
  },
  (token) => getOctokit(token),
).catch((e) => core.setFailed(errorMessage(e)));
