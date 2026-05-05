/** A file in a merge request diff. */
export interface DiffFile {
  oldPath: string
  newPath: string
  diff: string
  isNew: boolean
  isDeleted: boolean
  isRenamed: boolean
}

/** SHA references for diff positioning. */
export interface DiffVersion {
  baseSha: string
  startSha: string
  headSha: string
}

/** A discussion thread on a merge request. */
export interface Discussion {
  id: string
  notes: DiscussionNote[]
}

/** A single note within a discussion. */
export interface DiscussionNote {
  id: number
  body: string
  authorId: number
  authorUsername: string
  resolved: boolean
  filePath?: string
  line?: number
}

/** Position data for an inline comment. */
export interface InlineCommentPosition {
  baseSha: string
  startSha: string
  headSha: string
  filePath: string
  line: number
}

/** VCS provider operations — the contract adapters implement. */
export interface VcsProvider {
  getMergeRequestDiff(projectId: number, mrIid: number): Promise<DiffFile[]>
  getMergeRequestVersion(projectId: number, mrIid: number): Promise<DiffVersion | null>
  getDiscussions(projectId: number, mrIid: number): Promise<Discussion[]>
  createInlineComment(projectId: number, mrIid: number, body: string, position: InlineCommentPosition): Promise<void>
  createComment(projectId: number, mrIid: number, body: string): Promise<void>
  replyToDiscussion(projectId: number, mrIid: number, discussionId: string, body: string): Promise<void>
  resolveDiscussion(projectId: number, mrIid: number, discussionId: string, resolved: boolean): Promise<void>
  getFileContent(projectId: number, filePath: string, ref: string): Promise<string | null>
}

/** Normalized webhook event — VCS-agnostic. */
export interface WebhookEvent {
  kind: 'merge_request' | 'comment'
  mergeRequest?: {
    projectId: number
    iid: number
    title: string
    description: string | null
    sourceBranch: string
    targetBranch: string
    action: string
    authorId: number
  }
  comment?: {
    projectId: number
    mrIid: number
    discussionId: string
    body: string
    authorId: number
    sourceBranch: string
  }
}

/** Configuration for creating a VCS provider instance. */
export interface VcsPluginConfig {
  token: string
  url: string
}

/** Configuration schema field for settings forms. */
export interface ConfigField {
  name: string
  label: string
  type: 'text' | 'password' | 'url'
  required: boolean
  placeholder?: string
}

/** VCS Plugin — the contract every VCS provider must implement. */
export interface VcsPlugin {
  readonly type: string
  readonly name: string
  readonly description: string
  readonly configSchema: ConfigField[]
  readonly webhookAuthHeader: string

  createProvider(config: VcsPluginConfig): VcsProvider
  parseWebhookPayload(body: unknown): WebhookEvent | null
  validateWebhookAuth(headers: Record<string, string | undefined>, secret: string): boolean
}
