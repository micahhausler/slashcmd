import { createSign } from "node:crypto";
import * as core from "@actions/core";
import type { Octokit, OctokitFactory, Repo } from "./types";
import { errorMessage, errorStatus, Refusal } from "./types";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function createAppJwt(clientId: string, privateKey: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 60, iss: clientId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(privateKey.replace(/\\n/g, "\n")))}`;
}

export interface AppTokenOptions extends Repo {
  clientId: string;
  privateKey: string;
  octokit: OctokitFactory;
}

export async function mintInstallationToken(o: AppTokenOptions): Promise<string> {
  const jwt = createAppJwt(o.clientId, o.privateKey);
  core.setSecret(jwt);
  const app = o.octokit(jwt);
  let installationId: number;
  try {
    ({
      data: { id: installationId },
    } = await app.rest.apps.getRepoInstallation({ owner: o.owner, repo: o.repo }));
  } catch (e) {
    if (errorStatus(e) === 404) throw new Refusal(`the App ${o.clientId} is not installed on ${o.owner}/${o.repo}`);
    throw e;
  }
  const { data } = await app.rest.apps.createInstallationAccessToken({
    installation_id: installationId,
    repositories: [o.repo],
    permissions: { contents: "write" },
  });
  core.setSecret(data.token);
  return data.token;
}

export async function withAppToken<T>(o: AppTokenOptions, fn: (app: Octokit) => Promise<T>): Promise<T> {
  const app = o.octokit(await mintInstallationToken(o));
  try {
    return await fn(app);
  } finally {
    try {
      await app.rest.apps.revokeInstallationAccessToken();
    } catch (e) {
      core.warning(`revoking the App token failed: ${errorMessage(e)}`);
    }
  }
}
