import { describe, it, expect } from 'vitest'
import { isOAuthPlugin } from './types.js'
import type { VcsPlugin, OAuthPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField } from './types.js'

function createBasePlugin(): VcsPlugin {
  return {
    type: 'basic',
    name: 'Basic VCS',
    description: 'A basic plugin',
    configSchema: [],
    webhookAuthHeader: 'x-basic-token',
    createProvider(_config: VcsPluginConfig): VcsProvider {
      return {} as VcsProvider
    },
    parseWebhookPayload(_body: unknown): WebhookEvent | null {
      return null
    },
    validateWebhookAuth(): boolean {
      return false
    },
  }
}

function createOAuthPluginStub(): OAuthPlugin {
  return {
    ...createBasePlugin(),
    type: 'oauth-vcs',
    supportsOAuth: true as const,
    configureOAuth() {},
    getInstallUrl() { return 'https://example.com/install' },
    async handleCallback() { return { installationId: '1', account: 'org' } },
    async listInstallations() { return [] },
    async listInstallationRepos() { return [] },
  }
}

describe('isOAuthPlugin', () => {
  it('returns true for plugins with supportsOAuth: true', () => {
    const oauthPlugin = createOAuthPluginStub()
    expect(isOAuthPlugin(oauthPlugin)).toBe(true)
  })

  it('returns false for regular VcsPlugin', () => {
    const basic = createBasePlugin()
    expect(isOAuthPlugin(basic)).toBe(false)
  })

  it('returns false for plugins with supportsOAuth: false', () => {
    const fake = { ...createBasePlugin(), supportsOAuth: false } as unknown as VcsPlugin
    expect(isOAuthPlugin(fake)).toBe(false)
  })
})
