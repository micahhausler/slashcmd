import type { Octokit, Repo } from "./types";
import { errorStatus } from "./types";

export interface Decision {
  ok: boolean;
  reason: string;
}

export function parseAllowedUsers(input: string): Set<string> {
  return new Set(
    input
      .split(/\s+/)
      .filter(Boolean)
      .map((u) => u.toLowerCase()),
  );
}

export function authorize(login: string, permission: string, allowedUsers: string): Decision {
  if (permission !== "admin" && permission !== "write") {
    return { ok: false, reason: `${login} has ${permission} access, not write` };
  }
  const allowed = parseAllowedUsers(allowedUsers);
  if (allowed.size > 0 && !allowed.has(login.toLowerCase())) {
    return { ok: false, reason: `${login} is not in allowed-users` };
  }
  return { ok: true, reason: `${login} has ${permission} access` };
}

export async function getPermission(gh: Octokit, { owner, repo }: Repo, username: string): Promise<string> {
  try {
    const { data } = await gh.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username });
    return data.permission;
  } catch (e) {
    if (errorStatus(e) === 404) return "none";
    throw e;
  }
}
