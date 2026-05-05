import pino from 'pino'
import type { VcsProvider, DiffFile, DiffVersion, Discussion, InlineCommentPosition } from '../types.js'

const log = pino({ name: 'github' })

export class GitHubProvider implements VcsProvider {
  constructor(
    private readonly token: string,
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

    // Group by in_reply_to_id to form threads
    const threads = new Map<number, Discussion>()
    for (const c of comments) {
      const threadId = c.in_reply_to_id ?? c.id
      if (!threads.has(threadId)) {
        threads.set(threadId, { id: String(threadId), notes: [] })
      }
      threads.get(threadId)!.notes.push({
        id: c.id,
        body: c.body,
        authorId: c.user.id,
        authorUsername: c.user.login,
        resolved: false,
        filePath: c.path ?? undefined,
        line: c.line ?? undefined,
      })
    }
    return Array.from(threads.values())
  }

  async createInlineComment(
    projectId: number, mrIid: number, body: string, position: InlineCommentPosition
  ): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    await this.request(`/repos/${repo}/pulls/${mrIid}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        commit_id: position.headSha,
        path: position.filePath,
        line: position.line,
        side: 'RIGHT',
      }),
    })
  }

  async createComment(projectId: number, mrIid: number, body: string): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    await this.request(`/repos/${repo}/issues/${mrIid}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  }

  async replyToDiscussion(
    projectId: number, mrIid: number, discussionId: string, body: string
  ): Promise<void> {
    const repo = await this.resolveRepo(projectId)
    await this.request(`/repos/${repo}/pulls/${mrIid}/comments/${discussionId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  }

  async resolveDiscussion(
    _projectId: number, _mrIid: number, _discussionId: string, _resolved: boolean
  ): Promise<void> {
    // GitHub does not have a native resolve API for review comments
  }

  async getFileContent(projectId: number, filePath: string, ref: string): Promise<string | null> {
    try {
      const repo = await this.resolveRepo(projectId)
      const encoded = encodeURIComponent(filePath)
      const data = await this.request<{ content: string; encoding: string }>(
        `/repos/${repo}/contents/${encoded}?ref=${ref}`
      )
      if (data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }
      return data.content
    } catch {
      return null
    }
  }

  /**
   * GitHub identifies repos by owner/name, not numeric ID.
   * The webhook payload provides the full_name. For API calls triggered
   * by a webhook we store the full_name in a lightweight cache keyed by
   * the repository id that comes from the payload.
   */
  private repoCache = new Map<number, string>()

  /** Register a numeric-id → full_name mapping (called by the plugin when parsing the webhook). */
  registerRepo(id: number, fullName: string): void {
    this.repoCache.set(id, fullName)
  }

  private async resolveRepo(projectId: number): Promise<string> {
    const cached = this.repoCache.get(projectId)
    if (cached) return cached
    // Fallback: fetch from API
    const data = await this.request<{ full_name: string }>(`/repositories/${projectId}`)
    this.repoCache.set(projectId, data.full_name)
    return data.full_name
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    log.debug({ url, method: options.method ?? 'GET' }, 'API request')
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
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

interface GHFile {
  filename: string
  previous_filename?: string
  status: string
  patch?: string
}

interface GHReviewComment {
  id: number
  in_reply_to_id?: number
  body: string
  user: { id: number; login: string }
  path?: string
  line?: number
}
