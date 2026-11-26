import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actions/core";
import { run, type Event, type Inputs } from "../src/main";
import { summarize } from "../src/report";
import { commit, fakeOctokit } from "./helpers";

vi.mock("@actions/core");

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const inputs: Inputs = { appClientId: "Iv-test", appKey: privateKey, allowedUsers: "", githubToken: "gh-token" };

function event(body: string, overrides: Partial<Event> = {}): Event {
  return {
    eventName: "issue_comment",
    owner: "o",
    repo: "r",
    runUrl: "https://github.com/o/r/actions/runs/1",
    payload: {
      action: "created",
      issue: { number: 7, pull_request: { url: "x" } },
      comment: { id: 99, body, user: { login: "octo" } },
    },
    ...overrides,
  };
}

const reactions = (gh: ReturnType<typeof fakeOctokit>) =>
  gh.rest.reactions.createForIssueComment.mock.calls.map(([p]) => (p as { content: string }).content);

function setup(permission = "write") {
  const gh = fakeOctokit();
  const app = fakeOctokit();
  gh.rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({ data: { permission } });
  const factory = vi.fn((t: string) => (t === "gh-token" ? gh.octokit : app.octokit));
  return { gh, app, factory };
}

describe("run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_STEP_SUMMARY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ignores comments that aren't commands", async () => {
    const { gh, factory } = setup();
    await run(event("/unknown"), inputs, factory);
    await run(event("looks good"), inputs, factory);
    await run(event("/squash", { eventName: "pull_request" }), inputs, factory);
    expect(factory).not.toHaveBeenCalled();
    expect(gh.rest.repos.getCollaboratorPermissionLevel).not.toHaveBeenCalled();
  });

  it("ignores comments on issues", async () => {
    const { factory } = setup();
    const ev = event("/squash");
    delete ev.payload.issue!.pull_request;
    await run(ev, inputs, factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ["read access", "read", ""],
    ["no access", "none", ""],
    ["a writer outside allowed-users", "write", "someone"],
  ])("ignores %s without reacting or commenting", async (_name, permission, allowedUsers) => {
    const { gh, app, factory } = setup(permission);
    await run(event("/squash"), { ...inputs, allowedUsers }, factory);
    expect(core.notice).toHaveBeenCalledOnce();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(gh.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
    expect(gh.rest.issues.createComment).not.toHaveBeenCalled();
    expect(app.rest.apps.getRepoInstallation).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("reacts eyes then +1 on success, and masks the key, JWT, and token", async () => {
    const { gh, app, factory } = setup();
    app.rest.apps.getRepoInstallation.mockResolvedValue({ data: { id: 1 } });
    app.rest.apps.createInstallationAccessToken.mockResolvedValue({ data: { token: "ghs_x" } });
    gh.rest.pulls.get.mockResolvedValue({
      data: {
        state: "open",
        head: { ref: "f", sha: "a", repo: { full_name: "o/r" } },
        base: { ref: "main", repo: { full_name: "o/r", default_branch: "main", node_id: "R" } },
        commits: 1,
      },
    });
    gh.rest.pulls.listCommits.mockResolvedValue({ data: [commit("a", ["base"])] });
    gh.rest.repos.getBranch.mockResolvedValue({ data: { protected: false } });
    gh.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
      data: { merge_base_commit: { sha: "base", commit: { tree: { sha: "t" } } } },
    });

    await run(event("/squash"), inputs, factory);
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(reactions(gh)).toEqual(["eyes", "+1"]);
    expect(gh.rest.issues.createComment).not.toHaveBeenCalled();
    expect(app.rest.apps.revokeInstallationAccessToken).toHaveBeenCalledOnce();
    const masked = vi.mocked(core.setSecret).mock.calls.map(([v]) => v);
    expect(masked).toContain(privateKey);
    expect(masked).toContain("ghs_x");
    expect(masked.some((v) => /^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(v))).toBe(true);
  });

  it("reacts -1, comments with the refusal and run link, and fails", async () => {
    const { gh, app, factory } = setup("admin");
    app.rest.apps.getRepoInstallation.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
    await run(event("/squash"), inputs, factory);
    expect(reactions(gh)).toEqual(["eyes", "-1"]);
    expect(gh.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "o",
      repo: "r",
      issue_number: 7,
      body: "`/squash` failed: the App Iv-test is not installed on o/r\n\nhttps://github.com/o/r/actions/runs/1",
    });
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/not installed/));
  });

  it("comments only the run link for an unexpected error", async () => {
    const { gh, app, factory } = setup();
    app.rest.apps.getRepoInstallation.mockRejectedValue(Object.assign(new Error("secret detail"), { status: 500 }));
    await run(event("/squash"), inputs, factory);
    expect(reactions(gh)).toEqual(["eyes", "-1"]);
    expect(gh.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: "`/squash` failed: https://github.com/o/r/actions/runs/1" }),
    );
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/secret detail/));
  });

  it("fails without App inputs only after authorizing", async () => {
    const { gh, factory } = setup();
    await run(event("/squash"), { ...inputs, appClientId: "" }, factory);
    expect(reactions(gh)).toEqual(["eyes", "-1"]);
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/required/));
  });
});

describe("summarize", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes the step summary when the runner provides one", async () => {
    vi.stubEnv("GITHUB_STEP_SUMMARY", "/tmp/summary");
    const addRaw = vi.spyOn(core.summary, "addRaw").mockReturnValue(core.summary);
    const write = vi.spyOn(core.summary, "write").mockResolvedValue(core.summary);
    await summarize("squash", "squashed 3 commits");
    expect(addRaw).toHaveBeenCalledWith("`/squash`: squashed 3 commits", true);
    expect(write).toHaveBeenCalledOnce();
  });
});
