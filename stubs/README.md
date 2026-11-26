# Dependency stubs

The packages here replace two transitive runtime dependencies through `overrides` in `package.json`, so neither real package is installed or bundled.
`test/dist.test.ts` fails if either one returns to `dist/index.cjs`.

## tunnel

`tunnel` comes in through `@actions/http-client`, which calls it only when an HTTP proxy is configured.
Its last release was in 2018 and it has one maintainer.
The stub throws if called, so the action fails clearly behind a proxy instead of ignoring it.

## json-with-bigint

`json-with-bigint` comes in through `@octokit/request`, which uses it to encode every request and parse every response so that integers above 2^53 stay exact.
GitHub added it after some endpoints started returning 64-bit IDs (octokit/request.js#797), and it later needed a fix for a ReDoS on the response path (octokit/request.js#831).
It has one maintainer.
The action reads no integer that large: the installation and comment IDs it reuses are far below 2^53, and everything else it reads is a SHA, name, or string.
The stub passes `JSONParse` and `JSONStringify` through to `JSON.parse` and `JSON.stringify`.

## Removing a stub

A stub goes away when its package is maintained by more than one person and the action needs it, for example if GitHub moves installation or comment IDs to 64-bit integers, which would show up as 404s for the wrong ID.
Removing one means deleting its `overrides` entry and directory, running `npm install` and `npm run build`, and updating `test/dist.test.ts`.
If an `@octokit/request` or `@actions/http-client` update calls more of either package than the stub exports, the build or tests fail.
