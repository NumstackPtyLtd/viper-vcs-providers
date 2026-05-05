// Types
export type {
  VcsPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField,
  DiffFile, DiffVersion, Discussion, DiscussionNote, InlineCommentPosition,
} from './types.js'

// Registry
export { registry } from './registry.js'

// Plugins (exported for direct use / testing)
export { gitlabPlugin } from './gitlab/plugin.js'

// Auto-register all built-in plugins
import { registry } from './registry.js'
import { gitlabPlugin } from './gitlab/plugin.js'

registry.register(gitlabPlugin)
