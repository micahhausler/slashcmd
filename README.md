# slashcmd

slashcmd is a GitHub Action that runs slash commands from pull request comments, acting as a GitHub App so that CI runs on the branches it updates.
It needs no server: each repository runs the action on `issue_comment`, and the action talks only to the GitHub API, with no git checkout of the pull request.

## Commands

- `/squash` folds every commit on the pull request into its first commit, keeping that commit's message and author, and force-updates the branch only if it still points at the head the action read.

A comment runs a command when its first line is exactly that command, starting at the first character, with trailing whitespace ignored.
The trigger workflow starts the job only for comments from owners, members, and collaborators.
The action then runs a command only for a commenter with write or admin access to the repository, and only for logins in `allowed-users` when the workflow sets it.
The action ignores anyone else with a notice in the run log, and leaves no reaction or comment on the pull request.
For an authorized commenter, the action reacts with 👀 when it starts, 👍 when it succeeds, and 👎 plus a comment linking the run when it fails.
That comment also says why when the action refused the command, such as for a protected branch.

## How `/squash` works

The action reads the pull request and refuses closed pull requests, forks, the default branch, and protected branches.
It finds the merge base with the base branch and the first commit by following first parents from the head through the pull request's commits.
It refuses a branch whose oldest first-parent commit is a merge, or whose first-parent history leaves out some of the pull request's commits, since either has no single first commit to keep.
It creates one commit with the head's tree, the merge base as its parent, and the first commit's message and author, through the git data API.
It then moves the branch with the GraphQL `updateRefs` mutation, which fails if the branch moved since the action read it.
A pull request that already has one commit is left alone, so rerunning `/squash` is harmless.

## Using it

Each repository adds [`examples/slashcmd.yml`](examples/slashcmd.yml) as `.github/workflows/slashcmd.yml`, with `OWNER/slashcmd` replaced by the repository that hosts this action.
The action takes these inputs:

- `app-client-id` is the client ID of the App that updates branches.
- `app-key` is that App's private key.
- `allowed-users` is an optional space-separated list of logins allowed to run commands, matched case-insensitively.
- `github-token` defaults to the workflow's token, which handles permission lookups, reactions, comments, and every read of the pull request, its branch, and its commits.

The action signs a short-lived JWT with the App's key, and requests an installation token limited to the one repository and `contents: write`.
It uses that token only to create the squashed commit and move the branch, and revokes it when the command finishes.

## Keeping the key contained

Public and private repositories use separate Apps, so a key stored in a public repository can't update a private one.
Each repository's `SLASHCMD_APP_CLIENT_ID` variable names its App, and the `SLASHCMD_APP_KEY` secret lives in a `slashcmd` environment whose only deployment branch policy is the default branch.
A workflow on a pull request branch therefore can't read the key, and the `issue_comment` trigger always runs the default branch's workflow.

## Setting it up

[`bin/setup`](bin/setup) handles both one-time and per-repository setup, and needs bash 4.4 or newer, `gh`, and the 1Password CLI; `bin/setup app` also needs `jq` and `python3`.

- `bin/setup app [--name NAME]` creates an App through GitHub's manifest flow in the browser, under the owner of this checkout's `origin`, stores its private key and IDs in 1Password, and prints the install link.
  The second App needs `--name`, because App names are unique on GitHub.
- `bin/setup sync` reads a config file kept outside this repository that groups repositories under each App.
  For each repository, it creates the `slashcmd` environment, makes the default branch its only deployment branch policy, including after a rename, sets the environment's `SLASHCMD_APP_KEY` secret and the repository's `SLASHCMD_APP_CLIENT_ID` variable, and removes any repository-level `SLASHCMD_APP_KEY` secret.
  It also reports which repositories lack the current trigger workflow, which is `examples/slashcmd.yml` with `OWNER/slashcmd` replaced by the owner/repo of this checkout's `origin`.
  `--open-pr` opens or updates a pull request from the `slashcmd-workflow` branch adding it, resetting that branch to the default branch when no pull request from it is open.
  `--dry-run` prints what it would change, and one repository's failure doesn't stop the rest.

Each repository also needs the App installed, which only the install link can do.
A fork works the same way once it has its own Apps and config.

This repository runs the commands on itself through [`.github/workflows/commands.yml`](.github/workflows/commands.yml).

## Limits

- `/squash` works only on branches in the same repository, not forks.
- `/squash` handles pull requests of up to 250 commits, with a first-parent history that covers all of them.
- The App's token has no `workflows` permission, so `/squash` fails on pull requests that change `.github/workflows/`.
- The squashed commit records the first commit's author as both author and committer, and is unsigned, because GitHub signs an App's API commits only when they carry no custom author.
- Environment secrets in private repositories need a GitHub plan that supports environments there.

## Developing

`npm run build` bundles `src/` into `dist/index.cjs`, which is committed because the action runs it directly.
`npm test`, `npm run typecheck`, `npm run lint`, and `npm run check-dist` must pass, and CI runs all of them.
