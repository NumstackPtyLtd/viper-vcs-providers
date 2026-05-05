import type { VcsPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField } from '../types.js'
import { GitLabProvider } from './provider.js'

interface MrPayload {
  object_kind: 'merge_request'
  project: { id: number }
  object_attributes: {
    iid: number; title: string; description: string | null
    source_branch: string; target_branch: string; action?: string; author_id: number
  }
}

interface NotePayload {
  object_kind: 'note'
  project: { id: number }
  merge_request?: { iid: number; source_branch: string }
  object_attributes: { note: string; noteable_type: string; author_id: number; discussion_id: string }
}

export class GitLabPlugin implements VcsPlugin {
  readonly type = 'gitlab'
  readonly name = 'GitLab'
  readonly description = 'GitLab merge request reviews via webhooks'
  readonly webhookAuthHeader = 'x-gitlab-token'

  readonly configSchema: ConfigField[] = [
    { name: 'token', label: 'Private Token', type: 'password', required: true },
    { name: 'url', label: 'Instance URL', type: 'url', required: true },
  ]

  createProvider(config: VcsPluginConfig): VcsProvider {
    return new GitLabProvider(config.token, config.url)
  }

  parseWebhookPayload(body: unknown): WebhookEvent | null {
    if (!body || typeof body !== 'object') return null
    const p = body as Record<string, unknown>
    if (p.object_kind === 'merge_request') return this.parseMr(body as MrPayload)
    if (p.object_kind === 'note') return this.parseNote(body as NotePayload)
    return null
  }

  validateWebhookAuth(headers: Record<string, string | undefined>, secret: string): boolean {
    return headers[this.webhookAuthHeader] === secret
  }

  private parseMr(p: MrPayload): WebhookEvent {
    const mr = p.object_attributes
    return {
      kind: 'merge_request',
      mergeRequest: {
        projectId: p.project.id, iid: mr.iid, title: mr.title, description: mr.description,
        sourceBranch: mr.source_branch, targetBranch: mr.target_branch, action: mr.action ?? '', authorId: mr.author_id,
      },
    }
  }

  private parseNote(p: NotePayload): WebhookEvent | null {
    if (p.object_attributes.noteable_type !== 'MergeRequest' || !p.merge_request) return null
    return {
      kind: 'comment',
      comment: {
        projectId: p.project.id, mrIid: p.merge_request.iid,
        discussionId: p.object_attributes.discussion_id, body: p.object_attributes.note,
        authorId: p.object_attributes.author_id, sourceBranch: p.merge_request.source_branch,
      },
    }
  }
}

export const gitlabPlugin = new GitLabPlugin()
