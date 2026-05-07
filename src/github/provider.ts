import { createSign } from 'crypto'
import pino from 'pino'
import type { VcsProvider, DiffFile, DiffVersion, Discussion, InlineCommentPosition, CheckRunParams } from '../types.js'

const log = pino({ name: 'github' })

interface InstallationToken {
  token: string
  expiresAt: number
}

export class GitHubProvider implements VcsProvider {
  private installationToken: InstallationToken | null = null

  constructor(
    private readonly appId: string,
    private readonly privateKey: string,
    private readonly installationId: string,
    private readonly baseUrl: string
  ) {}

  async getMergeRequestDiff(projectId: number, mrIid: number): Promise<DiffFile[]> {
    const repo = await this.resolveRepo(projectId)
    const data = await this.request<GHFile[]>(`/repos/${repo}/pulls/${mrIid}/files`)
    return data.map((f) => ({
      oldPath: f.previous_filename ?? f.filename,
      newPath: f.filename,
      diff: f.patch ?? '',
      isNew: f.status === 'added',
      isDeleted: f.status === 'removed',
      isRenamed: f.status === 'renamed',
    }))
  }

  async getMergeRequestVersion(projectId: number, mrIid: number): Promise<DiffVersion | null> {
    const repo = await this.resolveRepo(projectId)
    const pr = await this.request<{ base: { sha: string }; head: { sha: string } }>(
      `/repos/${repo}/pulls/${mrIid}`
    )
    return { baseSha: pr.base.sha, startSha: pr.base.sha, headSha: pr.head.sha }
  }

  async getDiscussions(projectId: number, mrIid: number): Promise<Discussion[]> {
    const repo = await this.resolveRepo(projectId)
    const comments = await this.request<GHReviewComment[]>(
      `/repos/${repo}/pulls/${mrIid}/comments?per_page=100`
    )
    const threads = new Map<number, Discussion>()
    for (const c of comments) {
      const threadId = c.in_reply_to_id ?? c.id
      if (!threads.has(threadId)) {
        threads.set(threadId, { id: String(threadId), notes: [] })
      }
      threads.get(threadId)!.notes.push({
        id: c.id, body: c.body, authorId: c.user.id, authorUsername: c.user.login,
        resolved: false, filePath: c.path ?? undefined, line: c.line ?? undefined,
      })
    }
    return Array.from(threads.values())
  }

  async createInlineComment(projectId: number, mrIid: number, body: string, position: InlineCommentPosition): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    await this.request(`/repos/${repo}/pulls/${mrIid}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, commit_id: position.headSha, path: position.filePath, line: position.line, side: 'RIGHT' }),
    })
  }

  async createComment(projectId: number, mrIid: number, body: string): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    await this.request(`/repos/${repo}/issues/${mrIid}/comments`, {
      method: 'POST', body: JSON.stringify({ body }),
    })
  }

  async replyToDiscussion(projectId: number, mrIid: number, discussionId: string, body: string): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    await this.request(`/repos/${repo}/pulls/${mrIid}/comments/${discussionId}/replies`, {
      method: 'POST', body: JSON.stringify({ body }),
    })
  }

  async resolveDiscussion(): Promise<void> {
    // GitHub does not have a native resolve API for review comments
  }

  async getFileContent(projectId: number, filePath: string, ref: string): Promise<string | null> {
    try {
      const repo = await this.resolveRepo(projectId)
      const encoded = encodeURIComponent(filePath)
      const data = await this.request<{ content: string; encoding: string }>(
        `/repos/${repo}/contents/${encoded}?ref=${ref}`
      )
      return data.encoding === 'base64'
        ? Buffer.from(data.content, 'base64').toString('utf-8')
        : data.content
    } catch {
      return null
    }
  }

  async createCheckRun(projectId: number, params: CheckRunParams): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    const body: Record<string, unknown> = {
      name: 'Viper Review',
      head_sha: params.sha,
      status: params.status,
      output: {
        title: params.title,
        summary: params.summary,
      },
    }
    if (params.status === 'completed' && params.conclusion) {
      body.conclusion = params.conclusion
    }
    if (params.detailsUrl) {
      body.details_url = params.detailsUrl
    }
    await this.request(`/repos/${repo}/check-runs`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  // --- Repo cache ---

  private repoCache = new Map<number, string>()

  registerRepo(id: number, fullName: string): void {
    this.repoCache.set(id, fullName)
  }

  private async resolveRepo(projectId: number): Promise<string> {
    const cached = this.repoCache.get(projectId)
    if (cached) return cached
    const data = await this.request<{ full_name: string }>(`/repositories/${projectId}`)
    this.repoCache.set(projectId, data.full_name)
    return data.full_name
  }

  // --- GitHub App JWT + Installation Token ---

  private signJwt(): string {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: this.appId })).toString('base64url')
    const sign = createSign('RSA-SHA256')
    sign.update(`${header}.${payload}`)
    const signature = sign.sign(this.privateKey, 'base64url')
    return `${header}.${payload}.${signature}`
  }

  private async getInstallationToken(): Promise<string> {
    if (this.installationToken && Date.now() < this.installationToken.expiresAt) {
      return this.installationToken.token
    }

    const jwt = this.signJwt()
    const url = `${this.baseUrl}/app/installations/${this.installationId}/access_tokens`
    log.debug({ installationId: this.installationId }, 'Refreshing installation token')

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Failed to get installation token: ${res.status} ${body}`)
    }
    const data = await res.json() as { token: string; expires_at: string }
    this.installationToken = {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime() - 60_000, // refresh 1 min early
    }
    log.info('Installation token refreshed')
    return this.installationToken.token
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getInstallationToken()
    const url = `${this.baseUrl}${path}`
    log.debug({ url, method: options.method ?? 'GET' }, 'API request')
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GitHub API ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }
}

interface GHFile { filename: string; previous_filename?: string; status: string; patch?: string }
interface GHReviewComment { id: number; in_reply_to_id?: number; body: string; user: { id: number; login: string }; path?: string; line?: number }
