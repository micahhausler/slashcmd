import type { getOctokit } from "@actions/github";

export type Octokit = ReturnType<typeof getOctokit>;
export type OctokitFactory = (token: string) => Octokit;

export interface Repo {
  owner: string;
  repo: string;
}

export class Refusal extends Error {}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errorStatus(e: unknown): number | undefined {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export interface CommandContext extends Repo {
  gh: Octokit;
  app: Octokit;
  number: number;
}
