import { generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actions/core";
import { createAppJwt, withAppToken } from "../src/appToken";
import { Refusal } from "../src/types";
import { fakeOctokit } from "./helpers";

vi.mock("@actions/core");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const decode = (s: string): unknown => JSON.parse(Buffer.from(s, "base64url").toString());

describe("createAppJwt", () => {
  it("signs an RS256 JWT the public key verifies", () => {
    const now = 1_700_000_000_000;
    const jwt = createAppJwt("Iv-test", privateKey, now);
    const [h, p, s] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(p)).toEqual({ iat: 1_700_000_000 - 60, exp: 1_700_000_000 + 60, iss: "Iv-test" });
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("accepts a key with escaped newlines", () => {
    const jwt = createAppJwt("Iv-test", privateKey.replace(/\n/g, "\\n"));
    const [h, p, s] = jwt.split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("withAppToken", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup() {
    const jwtClient = fakeOctokit();
    const tokenClient = fakeOctokit();
    jwtClient.rest.apps.getRepoInstallation.mockResolvedValue({ data: { id: 42 } });
    jwtClient.rest.apps.createInstallationAccessToken.mockResolvedValue({ data: { token: "ghs_test" } });
    const factory = vi.fn((t: string) => (t === "ghs_test" ? tokenClient.octokit : jwtClient.octokit));
    return {
      jwtClient,
      tokenClient,
      factory,
      opts: { owner: "o", repo: "r", clientId: "Iv-test", privateKey, octokit: factory },
    };
  }

  it("scopes the token to the repository and contents: write, masks it, and revokes it", async () => {
    const { jwtClient, tokenClient, opts } = setup();
    const result = await withAppToken(opts, (app) => {
      expect(app).toBe(tokenClient.octokit);
      return Promise.resolve("done");
    });
    expect(result).toBe("done");
    expect(jwtClient.rest.apps.getRepoInstallation).toHaveBeenCalledWith({ owner: "o", repo: "r" });
    expect(jwtClient.rest.apps.createInstallationAccessToken).toHaveBeenCalledWith({
      installation_id: 42,
      repositories: ["r"],
      permissions: { contents: "write" },
    });
    expect(core.setSecret).toHaveBeenCalledWith(expect.stringMatching(/^ey[\w-]+\.[\w-]+\.[\w-]+$/));
    expect(core.setSecret).toHaveBeenCalledWith("ghs_test");
    expect(tokenClient.rest.apps.revokeInstallationAccessToken).toHaveBeenCalledOnce();
  });

  it("revokes the token when the command fails", async () => {
    const { tokenClient, opts } = setup();
    await expect(withAppToken(opts, () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    expect(tokenClient.rest.apps.revokeInstallationAccessToken).toHaveBeenCalledOnce();
  });

  it("refuses when the App isn't installed", async () => {
    const { jwtClient, opts } = setup();
    jwtClient.rest.apps.getRepoInstallation.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
    await expect(withAppToken(opts, () => Promise.resolve("x"))).rejects.toBeInstanceOf(Refusal);
  });
});
