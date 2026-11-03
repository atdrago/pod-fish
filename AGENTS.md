# AGENTS.md: pod-fish

Instructions for LLM agents working in this codebase.

## Principles

These are the engineering principles of this repository. Regard these rules above all others.

### Confidence

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence level.

### Modern Ideologies

Whenever deciding between a modern solution and a legacy one, always prefer the modern solution. If choosing the modern solution introduces technical debt, document this clearly and concisely with a `// TODO` comment. When weighing options, consider a modern solution that introduces technical debt and a legacy solution that introduces _no_ technical debt as the same thing. Legacy solutions are _inherently technical debt_.

### Captured learnings

After a solved, verified problem, offer once to invoke the `ce-compound` skill at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not offer. Completion, effort, and diff size alone are not enough. Offer at the checkpoint so a qualifying learning can ship in the PR that produced it, and only where the repository treats captured learnings as tracked, committed knowledge.

### Reports to the user

Write every report, summary, or handoff to the user through the `ce-noslop` skill. This applies when you are the top-level agent writing to the user, not when you are a subagent reporting to its caller. Do not apply it to code, config, verbatim quotes, or text the user asked to post as written.

## Open source and secrets

This repository is public, or it will be. Treat every commit, branch, and pull request as public from the first commit.

- Never commit a secret: an API token, an access key, a bucket credential, a Cloudflare API token, the Icecast source or admin password, a private key, a signed URL, or a session cookie.
- Never commit sensitive personal data: a real email address, a street address, a phone number, a listener IP address, or a log that holds one.
- Never commit the show itself. The show's content folder (the feed source files and the media) lives outside this repository, at the path that an environment variable names. The repository holds the app, its tests, its docs, and placeholder fixtures only.
- Read every configuration value from an environment variable: bucket names and credentials, domain names, public base URLs, the stream server address and its passwords, and every other value that differs between two installs. Commit `.env.example` with a placeholder value and a one-line comment for each variable. Never commit `.env` or another `.env.*` file. A test env file with fake values is the one exception, and it must say so in its first line.
- Use placeholder values in tests, fixtures, docs, and screenshots: `example.com`, `user@example.com`, `placeholder-token`.
- Before each commit, read the diff for a secret or a personal value. The secret scan in the gate is the backstop, not the rule.
- When a secret lands in a commit, treat it as leaked. Rotate it first. Then remove it from history, and rewrite a pushed branch only with the owner's approval.

## Verifying changes

The quality gates and their commands land with the first scaffold of the app. Update this section when they do.
