# slashcmd

slashcmd is a TypeScript GitHub Action that runs slash commands from pull request comments, acting as a GitHub App: one for public repositories, and a separate one for private repositories.

## Layout

- `action.yml` defines the action, which runs `dist/index.cjs` on Node 24.
- `src/` holds the source: `main.ts` handles the event, `parse.ts` reads the command, `authorize.ts` checks the commenter, `appToken.ts` mints and revokes the App token, `squash.ts` holds `/squash`, and `report.ts` posts reactions, comments, and the step summary.
- `test/` holds the Vitest tests, which mock Octokit and never call GitHub.
- `dist/index.cjs` is the esbuild bundle, committed because the action runs it directly.
- `examples/slashcmd.yml` is the trigger workflow other repositories copy, gated on the commenter's author association as a first filter; `bin/setup sync` replaces its `OWNER/slashcmd` with the owner/repo of `origin`.
- `.github/workflows/commands.yml` runs the action on this repository through `./`, so commands here use the default branch's version.
- `.github/workflows/ci.yml` runs typecheck, tests, lint, and the dist check.
- `bin/setup` creates Apps and syncs their keys and the trigger workflow to repositories listed in a config file outside this repository.

## Rules

- This repository is public, so it may say that private repositories use slashcmd but never names one, and never names a 1Password path or anything else about where the Apps' keys are synced. That lives in the sync config that `bin/setup sync` reads, outside this repository.
- Nothing hardcodes an owner, App name, or client ID; `bin/setup` derives the owner from `origin`, and each repository's `SLASHCMD_APP_CLIENT_ID` variable names its App.
- The action authorizes the commenter before any reaction, comment, or App token, and ignores unauthorized commenters silently apart from a log notice.
- Failure comments include only messages the action wrote (`Refusal`), never raw errors; other failures link the run.
- The App token requests only the permissions a command needs, for only the current repository, and is revoked when the command finishes; it only writes (for `/squash`, `createCommit` and `updateRefs`), and every read, reaction, and comment uses `github-token`.
- Commands never check out or run code from the pull request; they use only the GitHub API.
- Branch updates go through `updateRefs` with `beforeOid` set to the head the action read.
- A new command adds its name to `commands` in `src/parse.ts`, a handler in `src/main.ts`, tests, and an entry under "Commands" in the README.
- Code comments are short markers only.
- `npm run typecheck`, `npm test`, `npm run lint`, and `npm run check-dist` pass before every commit, and `dist/` is rebuilt with `npm run build` whenever `src/` or dependencies change.

- `stubs/` replaces two transitive dependencies through `overrides`; [`stubs/README.md`](stubs/README.md) records why and when a stub can go, and it stays current with any dependency change.

## Releases

- Callers pin `@v1`, a tag that moves to each compatible release; a breaking change to inputs starts `v2`.
