// Types
export type {
  VcsPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField,
  DiffFile, DiffVersion, Discussion, DiscussionNote, InlineCommentPosition,
  OAuthPlugin, OAuthRepo, OAuthCallbackResult, OAuthInstallation,
} from './types.js'
export { isOAuthPlugin } from './types.js'

// Registry
export { registry, PluginRegistry } from './registry.js'

// Routes
export { createOAuthRoutes } from './routes.js'
export type { OAuthRouteDeps } from './routes.js'

// Plugins (exported for direct use / testing)
export { gitlabPlugin } from './gitlab/plugin.js'
export { githubPlugin } from './github/plugin.js'

// Auto-register all built-in plugins
import { registry } from './registry.js'
import { gitlabPlugin } from './gitlab/plugin.js'
import { githubPlugin } from './github/plugin.js'

registry.register(gitlabPlugin)
registry.register(githubPlugin)
