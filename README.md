# pod-fish

A web app on a Mac that edits one podcast feed with every `podcast:` tag, publishes the feed and its media as static files to an object store, and goes live with one button. This repo also holds the Icecast stream server in `infra/icecast/`.

The show itself lives outside this repo, in the folder that `CONTENT_FOLDER` names.

## Setup

```sh
npm ci
npx playwright install chromium
brew install gitleaks
npx lefthook install
git config branch.main.mergeoptions --no-ff
cp .env.example .env
```

Then fill `.env`. It is gitignored. Never commit it.

- `npm ci` installs the git hooks on a fresh clone. `npx lefthook install` makes sure of it.
- `npm test` needs the Playwright browser, because component tests run in Chromium.
- The hooks fail closed when `gitleaks` is missing.
- `branch.main.mergeoptions` makes every merge into `main` create a commit. A fast-forward merge creates no commit, so no hook can gate it.

## Developing

```sh
npm run dev      # the app at http://127.0.0.1:5174
npm run build    # the production build, reads .env
npm start        # the production build at http://127.0.0.1:5174, reads .env
```

`npm run build` and `npm start` fail until every required value in `.env` is set, and the error names each missing value. SvelteKit validates the registry in `src/env.ts` when it analyzes the build and when the server starts.

The app listens on `127.0.0.1` only. A request with another `Host` is refused, and so is a write request from another `Origin` (`src/hooks.server.ts`).

## The show

[`docs/live-show-runbook.md`](docs/live-show-runbook.md) is the checklist for the show, the rehearsal, the fallbacks, and the stream server.

## Quality gates

```sh
npm run fix             # prettier --write and eslint --fix
npm run lint            # prettier --check and eslint, no writes
npm run check           # svelte-kit sync and svelte-check (types and accessibility)
npm run knip            # unused files, exports, and dependencies
npm run lint:nul-bytes  # no NUL byte in a tracked text file
npm test                # vitest, browser and node projects
```

| Event                | Jobs                                                      |
| -------------------- | --------------------------------------------------------- |
| Commit on `main`     | sync, format, lint, secrets, check, knip, nul-bytes, test |
| Merge into `main`    | sync, secrets, lint, check, knip, nul-bytes, test         |
| Commit on a branch   | sync, format and lint on the staged files, secrets        |
| Every commit message | commitlint, secrets                                       |

There is no pre-push gate.

To run the hooks by hand, use `--force`. Without it, lefthook skips every job when nothing is staged.

```sh
npx lefthook run pre-commit --verbose --force
npx lefthook run pre-merge-commit --verbose --force
```

The full gate takes longer than a light commit. The normal workflow is a branch first, then `git merge --no-ff <branch>` into `main`.
