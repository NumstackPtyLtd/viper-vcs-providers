/**
 * Generic OAuth routes for VCS plugins.
 *
 * The consumer mounts these without any VCS knowledge:
 *   app.route('/', createOAuthRoutes({ registry, getOrgId, onConnection, onRepos }))
 *
 * Routes created:
 *   GET  /api/vcs/oauth/providers       — list OAuth-capable providers
 *   GET  /api/vcs/oauth/:type/install   — redirect URL for the provider
 *   GET  /api/vcs/oauth/:type/callback  — handle the redirect back
 *   GET  /api/vcs/oauth/:type/repos     — list repos for an installation
 */
import { Hono } from 'hono'
import type { PluginRegistry } from './registry.js'
import { isOAuthPlugin } from './types.js'
import type { OAuthCallbackResult, OAuthRepo } from './types.js'

export interface OAuthRouteDeps {
  registry: PluginRegistry
  getOrgId: () => string
  /** Called when the OAuth callback completes. Store the connection. */
  onConnection: (orgId: string, provider: string, result: OAuthCallbackResult) => Promise<void> | void
  /** Called when repos are selected. Store the projects. */
  onRepos?: (orgId: string, provider: string, installationId: string, repos: OAuthRepo[]) => Promise<void> | void
  /** Base URL of the API server for building callback URLs. */
  baseUrl?: string
  /** Base URL of the dashboard for post-auth redirects. */
  dashboardUrl?: string
}

export function createOAuthRoutes(deps: OAuthRouteDeps): Hono {
  const app = new Hono()

  // List OAuth-capable providers
  app.get('/api/vcs/oauth/providers', (c) => {
    const providers = deps.registry.list()
      .filter(isOAuthPlugin)
      .map((p) => ({ type: p.type, name: p.name }))
    return c.json({ providers })
  })

  // Get install URL for a provider
  app.get('/api/vcs/oauth/:type/install', (c) => {
    const plugin = deps.registry.get(c.req.param('type'))
    if (!isOAuthPlugin(plugin)) {
      return c.json({ error: 'Provider does not support OAuth' }, 400)
    }
    const base = deps.baseUrl || new URL(c.req.url).origin
    const callbackUrl = `${base}/api/vcs/oauth/${plugin.type}/callback`
    return c.json({ url: plugin.getInstallUrl(callbackUrl) })
  })

  // Handle OAuth callback
  app.get('/api/vcs/oauth/:type/callback', async (c) => {
    const plugin = deps.registry.get(c.req.param('type'))
    if (!isOAuthPlugin(plugin)) {
      return c.json({ error: 'Provider does not support OAuth' }, 400)
    }

    const params: Record<string, string> = {}
    for (const [k, v] of new URL(c.req.url).searchParams) {
      params[k] = v
    }

    const result = await plugin.handleCallback(params)
    const orgId = deps.getOrgId()
    await deps.onConnection(orgId, plugin.type, result)

    // Post result to opener window and close the popup.
    // Falls back to redirect if not opened as popup.
    const msg = JSON.stringify({
      type: 'viper:oauth',
      provider: plugin.type,
      installationId: result.installationId,
      account: result.account,
    })
    const fallback = `${deps.dashboardUrl || ''}/setup?provider=${plugin.type}&installation_id=${result.installationId}&account=${encodeURIComponent(result.account)}`
    return c.html([
      '<!DOCTYPE html><html><body><script>',
      `var msg = ${msg};`,
      'if (window.opener) { window.opener.postMessage(msg, "*"); window.close(); }',
      `else { window.location.href = ${JSON.stringify(fallback)}; }`,
      '</script></body></html>',
    ].join('\n'))
  })

  // List existing installations for a provider
  app.get('/api/vcs/oauth/:type/installations', async (c) => {
    const plugin = deps.registry.get(c.req.param('type'))
    if (!isOAuthPlugin(plugin)) {
      return c.json({ error: 'Provider does not support OAuth' }, 400)
    }
    const installations = await plugin.listInstallations()
    return c.json({ installations })
  })

  // Connect an existing installation (store the connection without going through OAuth redirect)
  app.post('/api/vcs/oauth/:type/connect', async (c) => {
    const plugin = deps.registry.get(c.req.param('type'))
    if (!isOAuthPlugin(plugin)) {
      return c.json({ error: 'Provider does not support OAuth' }, 400)
    }

    const body = await c.req.json() as { installation_id: string }
    if (!body.installation_id) {
      return c.json({ error: 'installation_id required' }, 400)
    }

    const result = await plugin.handleCallback({ installation_id: body.installation_id })
    const orgId = deps.getOrgId()
    await deps.onConnection(orgId, plugin.type, result)
    return c.json({ status: 'ok', account: result.account })
  })

  // List repos for an installation
  app.get('/api/vcs/oauth/:type/repos', async (c) => {
    const plugin = deps.registry.get(c.req.param('type'))
    if (!isOAuthPlugin(plugin)) {
      return c.json({ error: 'Provider does not support OAuth' }, 400)
    }

    const installationId = c.req.query('installation_id')
    if (!installationId) {
      return c.json({ error: 'installation_id query param required' }, 400)
    }

    const repos = await plugin.listInstallationRepos(installationId)
    return c.json({ repos })
  })

  return app
}
