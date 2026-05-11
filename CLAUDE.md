# @supaproxy/viper-vcs-providers

VCS provider plugins for the Viper code review tool. Part of the Viper product within the SupaProxy ecosystem.

See the [central hub](https://github.com/NumstackPtyLtd/supaproxy) for cross-repo governance, workflow, and conventions.

## What this package does

This package provides a plugin registry, built-in VCS provider implementations, and generic OAuth routes for Viper. The server imports this package, registers plugins, and uses the registry to interact with version control platforms at runtime. Each plugin implements the `VcsPlugin` interface, which defines how to create a provider, parse webhooks, and validate webhook authentication. Plugins that support OAuth additionally implement `OAuthPlugin`.

## Project structure

```
src/
  index.ts            Public exports, auto-registers built-in plugins
  types.ts            Core interfaces: VcsPlugin, VcsProvider, OAuthPlugin, WebhookEvent, etc.
  registry.ts         PluginRegistry class (Map-based, keyed by type string)
  routes.ts           Generic OAuth Hono routes (provider-agnostic)
  github/
    plugin.ts          GitHubPlugin (implements OAuthPlugin)
    provider.ts        GitHubProvider (implements VcsProvider, uses GitHub App auth)
  gitlab/
    plugin.ts          GitLabPlugin (implements VcsPlugin)
    provider.ts        GitLabProvider (implements VcsProvider, uses Personal Access Token)
```

## Plugin/registry pattern

Every VCS provider is a plugin that implements the `VcsPlugin` interface:

```
interface VcsPlugin {
  readonly type: string
  readonly name: string
  readonly description: string
  readonly configSchema: ConfigField[]
  readonly webhookAuthHeader: string
  createProvider(config: VcsPluginConfig): VcsProvider
  parseWebhookPayload(body: unknown): WebhookEvent | null
  validateWebhookAuth(headers, secret, rawBody?): boolean
}
```

Plugins register themselves with the singleton `registry`:

```
import { registry } from './registry.js'
registry.register(myPlugin)
```

The registry provides `get(type)`, `has(type)`, `list()`, and `schemas()` methods. The server uses `registry.get(type)` to obtain a plugin, then calls `createProvider()` with the user's connection configuration.

Built-in plugins are auto-registered when the package is imported. The current built-in plugins are `githubPlugin` and `gitlabPlugin`.

### OAuth plugins

Plugins that support OAuth extend `VcsPlugin` with the `OAuthPlugin` interface, adding `configureOAuth()`, `getInstallUrl()`, `handleCallback()`, `listInstallations()`, and `listInstallationRepos()`. Use the `isOAuthPlugin()` type guard to check capability at runtime.

The `createOAuthRoutes()` function generates Hono routes for the full OAuth flow without any VCS-specific knowledge. The server mounts these routes and provides callbacks for storing connections and projects.

### Webhook normalisation

Each plugin translates platform-specific webhook payloads into a normalised `WebhookEvent` structure with `kind: 'merge_request' | 'comment'`. The server processes these events without knowing which VCS platform sent them.

## Adding a new VCS provider

1. Create a new directory under `src/` named after the provider (e.g. `src/bitbucket/`).
2. Create `plugin.ts` implementing `VcsPlugin` (or `OAuthPlugin` if OAuth is supported). Set `type` to a unique slug (e.g. `"bitbucket"`).
3. Create `provider.ts` implementing `VcsProvider` with all required methods: `getMergeRequestDiff()`, `getMergeRequestVersion()`, `getDiscussions()`, `createInlineComment()`, `createComment()`, `replyToDiscussion()`, `resolveDiscussion()`, `getFileContent()`, `createCheckRun()`, and `getReviewUrl()`.
4. Create `plugin.test.ts` with unit tests for webhook parsing and auth validation.
5. Export the plugin instance from `src/index.ts`.
6. Add `registry.register(yourPlugin)` in `src/index.ts` alongside existing registrations.

## Git workflow

NEVER push directly to `main`. NEVER run destructive git commands (`push --force`, `reset --hard`, `clean -f`).

All changes go through pull requests:

1. Create a feature branch: `git checkout -b {feat|fix|chore|docs}/description`
2. Make commits on the branch.
3. Push the branch: `git push -u origin {branch}`
4. Create a PR: `gh pr create`
5. Squash merge to main via the GitHub UI.

## Code standards

### Type safety

- No `any` types. Create interfaces for all API responses, webhook payloads, and function parameters.
- No `as any` casts. Define proper interfaces instead.
- Platform-specific response types belong inside the plugin directory, not in shared types.

### VCS agnosticism

- No hardcoded VCS platform names in user-facing output. Say "VCS provider" or "code host".
- The registry, routes, and shared types are platform-agnostic. All platform-specific logic lives inside the plugin directory.
- Webhook events use normalised field names (e.g. `mrIid`, not `pull_number` or `merge_request_iid`).
- The `VcsProvider` interface uses generic terms: "merge request" (not "pull request" or "MR"), "project" (not "repository" or "repo").

### No hardcoded values

- No env var fallbacks. Use `requireEnv()` with no defaults.
- No hardcoded API URLs outside plugin configuration. Base URLs are provided through `configSchema` or `VcsPluginConfig`.
- API version headers and endpoint paths belong in the plugin, not in shared code.

### Error handling

- Check `res.ok` before parsing JSON responses.
- No empty catch blocks. Every `.catch()` must log the actual error.
- `getFileContent()` returns `null` on failure rather than throwing.

### Writing standards

- British English throughout (colour, organisation, behaviour, licence).
- No em dashes or en dashes. Use commas, full stops, or semicolons.
- No smart quotes. Use straight quotes only.
- Sentence case for headings.

## Scripts

```bash
npm run build          # Compile TypeScript
npm run lint           # Type check without emitting
npm run test           # Run tests with Vitest
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
```

## Publishing

Published to npm as `@supaproxy/viper-vcs-providers`. Follow semver strictly. All tests and build must pass before publishing. Update CHANGELOG.md before every release.
