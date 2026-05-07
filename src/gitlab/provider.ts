import pino from 'pino'
import type { VcsProvider, DiffFile, DiffVersion, Discussion, InlineCommentPosition, CheckRunParams } from '../types.js'

const log = pino({ name: 'gitlab' })

export class GitLabProvider implements VcsProvider {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string
  ) {}

  async getMergeRequestDiff(projectId: number, mrIid: number): Promise<DiffFile[]> {
    const data = await this.request<{ changes: RawChange[] }>(
      `/projects/${projectId}/merge_requests/${mrIid}/changes`
    )
    return data.changes.map((c) => ({
      oldPath: c.old_path, newPath: c.new_path, diff: c.diff,
      isNew: c.new_file, isDeleted: c.deleted_file, isRenamed: c.renamed_file,
    }))
  }

  async getMergeRequestVersion(projectId: number, mrIid: number): Promise<DiffVersion | null> {
    const versions = await this.request<RawVersion[]>(
      `/projects/${projectId}/merge_requests/${mrIid}/versions`
    )
    if (versions.length === 0) return null
    const v = versions[0]
    return { baseSha: v.base_commit_sha, startSha: v.start_commit_sha, headSha: v.head_commit_sha }
  }

  async getDiscussions(projectId: number, mrIid: number): Promise<Discussion[]> {
    const raw = await this.request<RawDiscussion[]>(
      `/projects/${projectId}/merge_requests/${mrIid}/discussions?per_page=100`
    )
    return raw.map((d) => ({
      id: d.id,
      notes: d.notes.map((n) => ({
        id: n.id, body: n.body, authorId: n.author.id, authorUsername: n.author.username,
        resolved: n.resolved ?? false, filePath: n.position?.new_path, line: n.position?.new_line ?? undefined,
      })),
    }))
  }

  async createInlineComment(projectId: number, mrIid: number, body: string, position: InlineCommentPosition): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
      method: 'POST',
      body: JSON.stringify({
        body,
        position: {
          position_type: 'text', base_sha: position.baseSha, start_sha: position.startSha,
          head_sha: position.headSha, new_path: position.filePath, new_line: position.line,
        },
      }),
    })
  }

  async createComment(projectId: number, mrIid: number, body: string): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST', body: JSON.stringify({ body }),
    })
  }

  async replyToDiscussion(projectId: number, mrIid: number, discussionId: string, body: string): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes`, {
      method: 'POST', body: JSON.stringify({ body }),
    })
  }

  async resolveDiscussion(projectId: number, mrIid: number, discussionId: string, resolved: boolean): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}`, {
      method: 'PUT', body: JSON.stringify({ resolved }),
    })
  }

  async getFileContent(projectId: number, filePath: string, ref: string): Promise<string | null> {
    try {
      const encoded = encodeURIComponent(filePath)
      const data = await this.request<{ content: string }>(
        `/projects/${projectId}/repository/files/${encoded}?ref=${ref}`
      )
      return Buffer.from(data.content, 'base64').toString('utf-8')
    } catch {
      return null
    }
  }

  async createCheckRun(projectId: number, params: CheckRunParams): Promise<void> {
    // GitLab uses commit statuses (pipeline-style). Map check run to commit status.
    const state = params.status === 'in_progress' ? 'running'
      : params.conclusion === 'success' ? 'success'
      : params.conclusion === 'failure' ? 'failed'
      : 'success'
    await this.request(`/projects/${projectId}/statuses/${params.sha}`, {
      method: 'POST',
      body: JSON.stringify({
        state,
        name: 'Viper Review',
        description: params.title,
        target_url: params.detailsUrl,
      }),
    })
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`
    log.debug({ url, method: options.method ?? 'GET' }, 'API request')
    const res = await fetch(url, {
      ...options,
      headers: { 'PRIVATE-TOKEN': this.token, 'Content-Type': 'application/json', ...options.headers },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GitLab API ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }
}

interface RawChange { old_path: string; new_path: string; diff: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean }
interface RawVersion { id: number; base_commit_sha: string; start_commit_sha: string; head_commit_sha: string }
interface RawDiscussion { id: string; notes: RawNote[] }
interface RawNote { id: number; body: string; author: { id: number; username: string }; resolved?: boolean; position?: { new_path: string; new_line: number | null } }
