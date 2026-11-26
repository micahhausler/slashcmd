import { describe, expect, it } from "vitest";
import { authorize, getPermission } from "../src/authorize";
import { fakeOctokit } from "./helpers";

describe("authorize", () => {
  it.each(["admin", "write"])("allows %s", (permission) => {
    expect(authorize("octo", permission, "").ok).toBe(true);
  });

  it.each(["read", "triage", "none", "maintain"])("refuses %s", (permission) => {
    const d = authorize("octo", permission, "");
    expect(d.ok).toBe(false);
    expect(d.reason).toContain(permission);
  });

  it("matches allowed-users case-insensitively", () => {
    expect(authorize("Octo", "write", "someone  OCTO\tother").ok).toBe(true);
  });

  it("refuses writers missing from allowed-users", () => {
    expect(authorize("octo", "admin", "someone other")).toEqual({ ok: false, reason: "octo is not in allowed-users" });
  });

  it("still requires write when allowed-users lists the login", () => {
    expect(authorize("octo", "read", "octo").ok).toBe(false);
  });
});

describe("getPermission", () => {
  const repo = { owner: "o", repo: "r" };

  it.each([
    ["a maintainer, reported as write", { permission: "write", role_name: "maintain" }, true],
    ["a triager, reported as read", { permission: "read", role_name: "triage" }, false],
    ["a custom role on read, whatever its name", { permission: "read", role_name: "admin" }, false],
  ])("decides on .permission for %s", async (_name, data, ok) => {
    const { octokit, rest } = fakeOctokit();
    rest.repos.getCollaboratorPermissionLevel.mockResolvedValue({ data });
    expect(authorize("octo", await getPermission(octokit, repo, "octo"), "").ok).toBe(ok);
  });

  it("treats 404 as none", async () => {
    const { octokit, rest } = fakeOctokit();
    rest.repos.getCollaboratorPermissionLevel.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
    expect(await getPermission(octokit, repo, "ghost")).toBe("none");
  });

  it("rethrows other errors", async () => {
    const { octokit, rest } = fakeOctokit();
    rest.repos.getCollaboratorPermissionLevel.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    await expect(getPermission(octokit, repo, "octo")).rejects.toThrow("boom");
  });
});
