import { describe, it, expect, beforeEach } from 'vitest'
import { GitLabPlugin } from './plugin.js'

describe('GitLabPlugin', () => {
  let plugin: GitLabPlugin

  beforeEach(() => {
    plugin = new GitLabPlugin()
  })

  // --- Identity ---

  it('type is "gitlab"', () => {
    expect(plugin.type).toBe('gitlab')
  })

  it('name is "GitLab"', () => {
    expect(plugin.name).toBe('GitLab')
  })

  // --- parseWebhookPayload ---

  describe('parseWebhookPayload', () => {
    it('returns null for unknown payloads', () => {
      expect(plugin.parseWebhookPayload(null)).toBeNull()
      expect(plugin.parseWebhookPayload(undefined)).toBeNull()
      expect(plugin.parseWebhookPayload({})).toBeNull()
      expect(plugin.parseWebhookPayload({ object_kind: 'push' })).toBeNull()
    })

    it('parses merge_request events with headSha', () => {
      const payload = {
        object_kind: 'merge_request',
        project: { id: 10 },
        object_attributes: {
          iid: 3,
          title: 'My MR',
          description: 'MR description',
          source_branch: 'feat/new',
          target_branch: 'main',
          action: 'open',
          author_id: 5,
          last_commit: { id: 'deadbeef123' },
        },
      }

      const result = plugin.parseWebhookPayload(payload)
      expect(result).not.toBeNull()
      expect(result!.kind).toBe('merge_request')
      expect(result!.mergeRequest!.projectId).toBe(10)
      expect(result!.mergeRequest!.iid).toBe(3)
      expect(result!.mergeRequest!.title).toBe('My MR')
      expect(result!.mergeRequest!.description).toBe('MR description')
      expect(result!.mergeRequest!.sourceBranch).toBe('feat/new')
      expect(result!.mergeRequest!.targetBranch).toBe('main')
      expect(result!.mergeRequest!.headSha).toBe('deadbeef123')
      expect(result!.mergeRequest!.action).toBe('open')
      expect(result!.mergeRequest!.authorId).toBe(5)
    })

    it('handles merge_request without last_commit', () => {
      const payload = {
        object_kind: 'merge_request',
        project: { id: 10 },
        object_attributes: {
          iid: 4,
          title: 'No commit',
          description: null,
          source_branch: 'fix/thing',
          target_branch: 'main',
          action: 'update',
          author_id: 6,
        },
      }

      const result = plugin.parseWebhookPayload(payload)
      expect(result!.mergeRequest!.headSha).toBe('')
    })

    it('parses note events on MRs', () => {
      const payload = {
        object_kind: 'note',
        project: { id: 20 },
        merge_request: { iid: 8, source_branch: 'feat/comment' },
        object_attributes: {
          note: 'Looks good!',
          noteable_type: 'MergeRequest',
          author_id: 11,
          discussion_id: 'disc-abc',
        },
      }

      const result = plugin.parseWebhookPayload(payload)
      expect(result).not.toBeNull()
      expect(result!.kind).toBe('comment')
      expect(result!.comment!.projectId).toBe(20)
      expect(result!.comment!.mrIid).toBe(8)
      expect(result!.comment!.discussionId).toBe('disc-abc')
      expect(result!.comment!.body).toBe('Looks good!')
      expect(result!.comment!.authorId).toBe(11)
      expect(result!.comment!.sourceBranch).toBe('feat/comment')
    })

    it('ignores note events not on MRs', () => {
      const payload = {
        object_kind: 'note',
        project: { id: 20 },
        object_attributes: {
          note: 'Issue comment',
          noteable_type: 'Issue',
          author_id: 11,
          discussion_id: 'disc-xyz',
        },
      }

      expect(plugin.parseWebhookPayload(payload)).toBeNull()
    })

    it('ignores note events without merge_request field', () => {
      const payload = {
        object_kind: 'note',
        project: { id: 20 },
        object_attributes: {
          note: 'Orphan note',
          noteable_type: 'MergeRequest',
          author_id: 11,
          discussion_id: 'disc-orphan',
        },
      }

      expect(plugin.parseWebhookPayload(payload)).toBeNull()
    })
  })

  // --- validateWebhookAuth ---

  describe('validateWebhookAuth', () => {
    it('validates by comparing secret token header', () => {
      const secret = 'my-gitlab-secret'
      const result = plugin.validateWebhookAuth(
        { 'x-gitlab-token': secret },
        secret
      )
      expect(result).toBe(true)
    })

    it('rejects mismatched secret token', () => {
      const result = plugin.validateWebhookAuth(
        { 'x-gitlab-token': 'wrong-secret' },
        'correct-secret'
      )
      expect(result).toBe(false)
    })

    it('rejects when header is missing', () => {
      const result = plugin.validateWebhookAuth({}, 'secret')
      expect(result).toBe(false)
    })
  })
})
