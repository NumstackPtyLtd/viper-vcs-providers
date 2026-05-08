import { describe, it, expect, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import { GitHubPlugin } from './plugin.js'

describe('GitHubPlugin', () => {
  let plugin: GitHubPlugin

  beforeEach(() => {
    plugin = new GitHubPlugin()
  })

  // --- Identity ---

  it('type is "github"', () => {
    expect(plugin.type).toBe('github')
  })

  it('name is "GitHub"', () => {
    expect(plugin.name).toBe('GitHub')
  })

  it('supportsOAuth is true', () => {
    expect(plugin.supportsOAuth).toBe(true)
  })

  // --- Config schema ---

  it('configSchema has required fields: app_id, private_key, installation_id, url', () => {
    const names = plugin.configSchema.map((f) => f.name)
    expect(names).toContain('app_id')
    expect(names).toContain('private_key')
    expect(names).toContain('installation_id')
    expect(names).toContain('url')

    for (const field of plugin.configSchema) {
      expect(field.required).toBe(true)
    }
  })

  // --- parseWebhookPayload ---

  describe('parseWebhookPayload', () => {
    it('returns null for unknown payloads', () => {
      expect(plugin.parseWebhookPayload(null)).toBeNull()
      expect(plugin.parseWebhookPayload(undefined)).toBeNull()
      expect(plugin.parseWebhookPayload(42)).toBeNull()
      expect(plugin.parseWebhookPayload('string')).toBeNull()
      expect(plugin.parseWebhookPayload({})).toBeNull()
      expect(plugin.parseWebhookPayload({ random: 'data' })).toBeNull()
    })

    it('parses pull_request opened event', () => {
      const payload = makePrPayload('opened')
      const result = plugin.parseWebhookPayload(payload)

      expect(result).not.toBeNull()
      expect(result!.kind).toBe('merge_request')
      expect(result!.mergeRequest).toBeDefined()
      expect(result!.mergeRequest!.action).toBe('open')
      expect(result!.mergeRequest!.projectId).toBe(123)
      expect(result!.mergeRequest!.iid).toBe(7)
      expect(result!.mergeRequest!.title).toBe('Test PR')
    })

    it('parses pull_request reopened event', () => {
      const result = plugin.parseWebhookPayload(makePrPayload('reopened'))
      expect(result!.mergeRequest!.action).toBe('reopen')
    })

    it('parses pull_request synchronize event', () => {
      const result = plugin.parseWebhookPayload(makePrPayload('synchronize'))
      expect(result!.mergeRequest!.action).toBe('update')
    })

    it('extracts headSha from pull_request.head.sha', () => {
      const result = plugin.parseWebhookPayload(makePrPayload('opened'))
      expect(result!.mergeRequest!.headSha).toBe('abc123sha')
    })

    it('ignores non-reviewable actions (closed, edited)', () => {
      expect(plugin.parseWebhookPayload(makePrPayload('closed'))).toBeNull()
      expect(plugin.parseWebhookPayload(makePrPayload('edited'))).toBeNull()
      expect(plugin.parseWebhookPayload(makePrPayload('labeled'))).toBeNull()
    })

    it('parses pull_request_review_comment events', () => {
      const payload = {
        action: 'created',
        comment: {
          id: 501,
          body: 'Nice change!',
          user: { id: 99 },
          in_reply_to_id: 500,
        },
        pull_request: { number: 10, head: { ref: 'feat/branch' } },
        repository: { id: 200, full_name: 'org/repo' },
      }

      const result = plugin.parseWebhookPayload(payload)
      expect(result).not.toBeNull()
      expect(result!.kind).toBe('comment')
      expect(result!.comment!.projectId).toBe(200)
      expect(result!.comment!.mrIid).toBe(10)
      expect(result!.comment!.discussionId).toBe('500')
      expect(result!.comment!.body).toBe('Nice change!')
      expect(result!.comment!.authorId).toBe(99)
      expect(result!.comment!.sourceBranch).toBe('feat/branch')
    })

    it('parses pull_request_review_comment without in_reply_to_id', () => {
      const payload = {
        action: 'created',
        comment: {
          id: 600,
          body: 'Top-level comment',
          user: { id: 42 },
        },
        pull_request: { number: 5, head: { ref: 'fix/bug' } },
        repository: { id: 300, full_name: 'org/repo' },
      }

      const result = plugin.parseWebhookPayload(payload)
      expect(result!.comment!.discussionId).toBe('600')
    })

    it('parses issue_comment events on PRs', () => {
      const payload = {
        action: 'created',
        issue: { number: 15, pull_request: { url: 'https://api.github.com/repos/org/repo/pulls/15' } },
        comment: { id: 700, body: 'General comment', user: { id: 55 } },
        repository: { id: 400, full_name: 'org/repo' },
      }

      const result = plugin.parseWebhookPayload(payload)
      expect(result).not.toBeNull()
      expect(result!.kind).toBe('comment')
      expect(result!.comment!.mrIid).toBe(15)
      expect(result!.comment!.discussionId).toBe('700')
      expect(result!.comment!.body).toBe('General comment')
      expect(result!.comment!.sourceBranch).toBe('')
    })

    it('ignores issue_comment events on non-PR issues', () => {
      const payload = {
        action: 'created',
        issue: { number: 20 },
        comment: { id: 800, body: 'Not a PR comment', user: { id: 1 } },
        repository: { id: 500, full_name: 'org/repo' },
      }

      expect(plugin.parseWebhookPayload(payload)).toBeNull()
    })

    it('ignores non-created pull_request_review_comment actions', () => {
      const payload = {
        action: 'deleted',
        comment: { id: 900, body: 'Deleted', user: { id: 1 } },
        pull_request: { number: 1, head: { ref: 'main' } },
        repository: { id: 100, full_name: 'org/repo' },
      }

      expect(plugin.parseWebhookPayload(payload)).toBeNull()
    })
  })

  // --- validateWebhookAuth ---

  describe('validateWebhookAuth', () => {
    it('validates HMAC-SHA256 signatures', () => {
      const secret = 'my-webhook-secret'
      const rawBody = '{"action":"opened"}'
      const sig = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex')

      const result = plugin.validateWebhookAuth(
        { 'x-hub-signature-256': sig },
        secret,
        rawBody
      )
      expect(result).toBe(true)
    })

    it('rejects invalid signatures', () => {
      const secret = 'my-webhook-secret'
      const rawBody = '{"action":"opened"}'

      const result = plugin.validateWebhookAuth(
        { 'x-hub-signature-256': 'sha256=invalid' },
        secret,
        rawBody
      )
      expect(result).toBe(false)
    })

    it('rejects when signature header is missing', () => {
      const result = plugin.validateWebhookAuth({}, 'secret', '{}')
      expect(result).toBe(false)
    })

    it('rejects when rawBody is missing', () => {
      const result = plugin.validateWebhookAuth(
        { 'x-hub-signature-256': 'sha256=abc' },
        'secret'
      )
      expect(result).toBe(false)
    })

    it('rejects when signature has wrong length', () => {
      const secret = 'my-secret'
      const rawBody = '{"test":true}'
      const result = plugin.validateWebhookAuth(
        { 'x-hub-signature-256': 'sha256=short' },
        secret,
        rawBody
      )
      expect(result).toBe(false)
    })
  })

  // --- OAuth ---

  describe('getInstallUrl', () => {
    it('throws if OAuth not configured', () => {
      expect(() => plugin.getInstallUrl('https://example.com/callback')).toThrow(
        'GitHub App slug not configured'
      )
    })

    it('returns correct URL after configureOAuth', () => {
      plugin.configureOAuth({
        app_id: '12345',
        private_key: 'fake-key',
        app_slug: 'my-app',
      })

      const url = plugin.getInstallUrl('https://example.com/callback')
      expect(url).toBe('https://github.com/apps/my-app/installations/new')
    })
  })

  describe('handleCallback', () => {
    it('throws on missing installation_id', async () => {
      plugin.configureOAuth({
        app_id: '12345',
        private_key: 'fake-key',
        app_slug: 'my-app',
      })

      await expect(plugin.handleCallback({})).rejects.toThrow(
        'Missing installation_id parameter'
      )
    })
  })
})

// --- Helpers ---

function makePrPayload(action: string) {
  return {
    action,
    number: 7,
    pull_request: {
      title: 'Test PR',
      body: 'PR description',
      head: { ref: 'feat/test', sha: 'abc123sha' },
      base: { ref: 'main' },
      user: { id: 42 },
    },
    repository: { id: 123, full_name: 'org/repo' },
  }
}
