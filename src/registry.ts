import pino from 'pino'
import type { VcsPlugin } from './types.js'

const log = pino({ name: 'vcs-registry' })

export class PluginRegistry {
  readonly plugins = new Map<string, VcsPlugin>()

  register(plugin: VcsPlugin): void {
    if (this.plugins.has(plugin.type)) {
      log.warn({ type: plugin.type }, 'Plugin already registered, replacing')
    }
    this.plugins.set(plugin.type, plugin)
    log.info({ type: plugin.type, name: plugin.name }, 'VCS plugin registered')
  }

  get(type: string): VcsPlugin {
    const plugin = this.plugins.get(type)
    if (!plugin) {
      const available = Array.from(this.plugins.keys()).join(', ')
      throw new Error(`VCS plugin not found: "${type}". Available: ${available || 'none'}`)
    }
    return plugin
  }

  has(type: string): boolean {
    return this.plugins.has(type)
  }

  list(): VcsPlugin[] {
    return Array.from(this.plugins.values())
  }

  schemas(): Array<{
    type: string
    name: string
    description: string
    configSchema: VcsPlugin['configSchema']
  }> {
    return this.list().map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      configSchema: p.configSchema,
    }))
  }
}

export const registry = new PluginRegistry()
