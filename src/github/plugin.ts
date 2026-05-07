import { createHmac, createSign, timingSafeEqual } from 'crypto'
import type { VcsPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField, OAuthPlugin, OAuthRepo, OAuthCallbackResult, OAuthInstallation } from '../types.js'
import { GitHubProvider } from './provider.js'

interface PrPayload {
  action: string
  number: number
  pull_request: {
    title: string
    body: string | null
    head: { ref: string; sha: string }
    base: { ref: string }
    user: { id: number }
  }
  repository: { id: number; full_name: string }
}

interface PrReviewCommentPayload {
  action: string
  comment: {
    id: number
    body: string
    user: { id: number }
    in_reply_to_id?: number
    pull_request_review_id?: number
  }
  pull_request: { number: number; head: { ref: string } }
  repository: { id: number; full_name: string }
}

interface IssueCommentPayload {
  action: string
  issue: { number: number; pull_request?: { url: string } }
  comment: { id: number; body: string; user: { id: number } }
  repository: { id: number; full_name: string }
}

export class GitHubPlugin implements OAuthPlugin {
  readonly type = 'github'
  readonly name = 'GitHub'
  readonly description = 'GitHub pull request reviews via webhooks'
  readonly webhookAuthHeader = 'x-hub-signature-256'
  readonly supportsOAuth = true as const

  readonly configSchema: ConfigField[] = [
    { name: 'app_id', label: 'App ID', type: 'text', required: true, helpText: 'GitHub > Settings > Developer settings > GitHub Apps. The numeric App ID shown on the app page.' },
    { name: 'private_key', label: 'Private Key (PEM)', type: 'textarea', required: true, placeholder: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----', helpText: 'Generate a private key on the GitHub App page. Paste the full contents of the .pem file.' },
    { name: 'installation_id', label: 'Installation ID', type: 'text', required: true, helpText: 'Install the app on your org/repo. The installation ID is in the URL: github.com/settings/installations/{id}.' },
    { name: 'url', label: 'API URL', type: 'url', required: true, defaultValue: 'https://api.github.com', helpText: 'Only change for GitHub Enterprise Server.', advanced: true },
  ]

  private provider: GitHubProvider | null = null
  private oauthAppId: string | null = null
  private oauthPrivateKey: string | null = null
  private oauthAppSlug: string | null = null
  private oauthBaseUrl = 'https://api.github.com'

  createProvider(config: VcsPluginConfig): VcsProvider {
    this.provider = new GitHubProvider(
      config.app_id,
      config.private_key,
      config.installation_id,
      config.url || 'https://api.github.com'
    )
    return this.provider
  }

  configureOAuth(config: Record<string, string>): void {
    this.oauthAppId = config.app_id
    this.oauthPrivateKey = config.private_key
    this.oauthAppSlug = config.app_slug ?? null
    this.oauthBaseUrl = config.url || 'https://api.github.com'
  }

  getInstallUrl(_callbackUrl: string): string {
    if (!this.oauthAppSlug) throw new Error('GitHub App slug not configured. Call configureOAuth first.')
    return `https://github.com/apps/${this.oauthAppSlug}/installations/new`
  }

  async handleCallback(params: Record<string, string>): Promise<OAuthCallbackResult> {
    const installationId = params.installation_id
    if (!installationId) throw new Error('Missing installation_id parameter')

    const { account } = await this.fetchInstallation(installationId)
    return { installationId, account }
  }

  async listInstallations(): Promise<OAuthInstallation[]> {
    if (!this.oauthAppId || !this.oauthPrivateKey) throw new Error('OAuth not configured')
    const jwt = this.signOAuthJwt()
    const res = await fetch(`${this.oauthBaseUrl}/app/installations`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    const data = await res.json() as Array<{ id: number; account: { login: string } }>
    return data.map((i) => ({ installationId: String(i.id), account: i.account.login }))
  }

  async listInstallationRepos(installationId: string): Promise<OAuthRepo[]> {
    const token = await this.getOAuthInstallationToken(installationId)
    const res = await fetch(`${this.oauthBaseUrl}/installation/repositories?per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    const data = await res.json() as { repositories: Array<{ id: number; name: string; full_name: string; default_branch: string; language: string | null; private: boolean }> }
    return data.repositories.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
      language: r.language,
      private: r.private,
    }))
  }

  private async fetchInstallation(installationId: string): Promise<{ account: string }> {
    if (!this.oauthAppId || !this.oauthPrivateKey) throw new Error('OAuth not configured')
    const jwt = this.signOAuthJwt()
    const res = await fetch(`${this.oauthBaseUrl}/app/installations/${installationId}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    const data = await res.json() as { account: { login: string } }
    return { account: data.account.login }
  }

  private async getOAuthInstallationToken(installationId: string): Promise<string> {
    if (!this.oauthAppId || !this.oauthPrivateKey) throw new Error('OAuth not configured')
    const jwt = this.signOAuthJwt()
    const res = await fetch(`${this.oauthBaseUrl}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
    const data = await res.json() as { token: string }
    return data.token
  }

  private signOAuthJwt(): string {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: this.oauthAppId })).toString('base64url')
    const sign = createSign('RSA-SHA256')
    sign.update(`${header}.${payload}`)
    const signature = sign.sign(this.oauthPrivateKey!, 'base64url')
    return `${header}.${payload}.${signature}`
  }

  parseWebhookPayload(body: unknown): WebhookEvent | null {
    if (!body || typeof body !== 'object') return null
    const p = body as Record<string, unknown>

    // pull_request event
    if ('pull_request' in p && 'action' in p && !('comment' in p) && !('issue' in p)) {
      return this.parsePr(p as unknown as PrPayload)
    }

    // pull_request_review_comment event
    if ('comment' in p && 'pull_request' in p && !('issue' in p)) {
      return this.parsePrComment(p as unknown as PrReviewCommentPayload)
    }

    // issue_comment event on a PR
    if ('issue' in p && 'comment' in p) {
      const issue = (p as unknown as IssueCommentPayload).issue
      if (issue.pull_request) {
        return this.parseIssueComment(p as unknown as IssueCommentPayload)
      }
    }

    return null
  }

  validateWebhookAuth(headers: Record<string, string | undefined>, secret: string, rawBody?: string): boolean {
    const signature = headers[this.webhookAuthHeader]
    if (!signature || !rawBody) return false

    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    } catch {
      return false
    }
  }

  private parsePr(p: PrPayload): WebhookEvent | null {
    const actionMap: Record<string, string> = {
      opened: 'open', reopened: 'reopen', synchronize: 'update',
    }
    const action = actionMap[p.action]
    if (!action) return null

    this.cacheRepo(p.repository.id, p.repository.full_name)

    return {
      kind: 'merge_request',
      mergeRequest: {
        projectId: p.repository.id,
        iid: p.number,
        title: p.pull_request.title,
        description: p.pull_request.body,
        sourceBranch: p.pull_request.head.ref,
        targetBranch: p.pull_request.base.ref,
        headSha: p.pull_request.head.sha,
        action,
        authorId: p.pull_request.user.id,
      },
    }
  }

  private parsePrComment(p: PrReviewCommentPayload): WebhookEvent | null {
    if (p.action !== 'created') return null
    this.cacheRepo(p.repository.id, p.repository.full_name)

    return {
      kind: 'comment',
      comment: {
        projectId: p.repository.id,
        mrIid: p.pull_request.number,
        discussionId: String(p.comment.in_reply_to_id ?? p.comment.id),
        body: p.comment.body,
        authorId: p.comment.user.id,
        sourceBranch: p.pull_request.head.ref,
      },
    }
  }

  private parseIssueComment(p: IssueCommentPayload): WebhookEvent | null {
    if (p.action !== 'created') return null
    this.cacheRepo(p.repository.id, p.repository.full_name)

    return {
      kind: 'comment',
      comment: {
        projectId: p.repository.id,
        mrIid: p.issue.number,
        discussionId: String(p.comment.id),
        body: p.comment.body,
        authorId: p.comment.user.id,
        sourceBranch: '',
      },
    }
  }

  private cacheRepo(id: number, fullName: string): void {
    if (this.provider) {
      this.provider.registerRepo(id, fullName)
    }
  }
}

export const githubPlugin = new GitHubPlugin()
