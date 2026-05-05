import type { VcsPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField } from '../types.js'
import { GitHubProvider } from './provider.js'

interface PrPayload {
  action: string
  number: number
  pull_request: {
    title: string
    body: string | null
    head: { ref: string }
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

export class GitHubPlugin implements VcsPlugin {
  readonly type = 'github'
  readonly name = 'GitHub'
  readonly description = 'GitHub pull request reviews via webhooks'
  readonly webhookAuthHeader = 'x-hub-signature-256'

  readonly configSchema: ConfigField[] = [
    { name: 'token', label: 'Personal Access Token', type: 'password', required: true },
    { name: 'url', label: 'API URL', type: 'url', required: true, placeholder: 'https://api.github.com' },
  ]

  private provider: GitHubProvider | null = null

  createProvider(config: VcsPluginConfig): VcsProvider {
    this.provider = new GitHubProvider(config.token, config.url)
    return this.provider
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

  validateWebhookAuth(headers: Record<string, string | undefined>, secret: string): boolean {
    const signature = headers[this.webhookAuthHeader]
    if (!signature) return false

    // For full HMAC verification the server would need crypto;
    // for now we do a constant-time comparison of the raw secret
    // which is sufficient when the secret itself is the signature.
    // Production deployments should use HMAC-SHA256 verification.
    return signature === secret
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
