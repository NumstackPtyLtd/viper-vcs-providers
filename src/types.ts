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

/** Check run conclusion — determines merge gating. */
export type CheckConclusion = 'success' | 'failure' | 'neutral'

/** Check run parameters. */
export interface CheckRunParams {
  /** Commit SHA to attach the check to. */
  sha: string
  /** Status: in_progress while reviewing, completed when done. */
  status: 'in_progress' | 'completed'
  /** Only required when status is completed. */
  conclusion?: CheckConclusion
  /** Title shown in the checks UI. */
  title: string
  /** Summary text (markdown supported). */
  summary: string
  /** Optional URL for "Details" link. */
  detailsUrl?: string
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
  /** Create or update a check run on a commit. Used for merge gating. */
  createCheckRun(projectId: number, params: CheckRunParams): Promise<void>
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
    headSha: string
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

/** Configuration for creating a VCS provider instance. Keys match configSchema field names. */
export type VcsPluginConfig = Record<string, string>

/** Configuration schema field for settings forms. */
export interface ConfigField {
  name: string
  label: string
  type: 'text' | 'password' | 'url' | 'textarea'
  required: boolean
  placeholder?: string
  defaultValue?: string
  helpText?: string
  /** If true, field is hidden by default (advanced/self-hosted). */
  advanced?: boolean
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
  validateWebhookAuth(headers: Record<string, string | undefined>, secret: string, rawBody?: string): boolean
}

/** A repo returned from an OAuth installation. */
export interface OAuthRepo {
  id: number
  name: string
  fullName: string
  defaultBranch: string
  language: string | null
  private: boolean
}

/** Result from handling an OAuth callback. */
export interface OAuthCallbackResult {
  installationId: string
  account: string
}

/** An existing installation of the app. */
export interface OAuthInstallation {
  installationId: string
  account: string
}

/** OAuth-capable VCS plugin. Extends VcsPlugin with install/callback/repo-listing. */
export interface OAuthPlugin extends VcsPlugin {
  readonly supportsOAuth: true

  /** Initialise with platform credentials (app ID, private key, etc.). */
  configureOAuth(config: Record<string, string>): void

  /** URL the user should visit to authorise/install the app. */
  getInstallUrl(callbackUrl: string): string

  /** Process the redirect params after the user authorises. */
  handleCallback(params: Record<string, string>): Promise<OAuthCallbackResult>

  /** List existing installations of this app. */
  listInstallations(): Promise<OAuthInstallation[]>

  /** List repos accessible to an installation. */
  listInstallationRepos(installationId: string): Promise<OAuthRepo[]>
}

/** Type guard for OAuthPlugin. */
export function isOAuthPlugin(plugin: VcsPlugin): plugin is OAuthPlugin {
  return 'supportsOAuth' in plugin && (plugin as OAuthPlugin).supportsOAuth === true
}
