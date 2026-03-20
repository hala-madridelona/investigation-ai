import type {
  BaseToolOutput,
  EntityExtractionResult,
  EvidenceReference,
  GitHubToolInput,
  ToolExecutionContext,
  ToolResult,
  ToolSignal,
} from '../index.js';
import {
  asProviderArray,
  asProviderRecord,
  asProviderString,
  createEntity,
  createSignal,
  createToolExecutionError,
  dedupeById,
  extractProviderResponse,
  fetchJson,
  stableConfidence,
  stableId,
  StubToolAdapter,
} from './base.js';

const buildGitHubUrl = (input: GitHubToolInput): string => {
  if (input.repository && input.issueOrPullRequestNumber) {
    return `https://api.github.com/repos/${input.repository}/issues/${input.issueOrPullRequestNumber}`;
  }
  if (input.repository) {
    return `https://api.github.com/repos/${input.repository}/issues?state=all&per_page=${input.limit ?? 20}`;
  }
  return 'https://api.github.com/search/issues';
};

const buildGitHubInit = (_input: GitHubToolInput, token: string | undefined) => ({
  method: 'GET',
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'investigation-ai-tools',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
});

export class GitHubAdapter extends StubToolAdapter<GitHubToolInput, BaseToolOutput> {
  readonly name = 'github' as const;

  protected async executeWithProvider(
    input: GitHubToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    try {
      const response = await extractProviderResponse(this.name, input, context, async () => {
        const token = asProviderString(asProviderRecord(context.metadata)?.githubToken);
        const url = buildGitHubUrl(input);
        if (!input.repository) {
          const query = `q=${encodeURIComponent(input.query)}&per_page=${encodeURIComponent(String(input.limit ?? 20))}`;
          return fetchJson(`${url}?${query}`, buildGitHubInit(input, token));
        }
        return fetchJson(url, buildGitHubInit(input, token));
      });

      const record = asProviderRecord(response);
      const items = Array.isArray(response)
        ? asProviderArray(response)
        : record?.items
          ? asProviderArray(record.items)
          : [response];
      const evidence: EvidenceReference[] = [];
      const entities: EntityExtractionResult[] = [];
      const signals: ToolSignal[] = [];

      for (const item of items) {
        const issue = asProviderRecord(item);
        if (!issue) continue;
        const htmlUrl = asProviderString(issue.html_url) ?? 'https://github.com';
        const title = asProviderString(issue.title) ?? 'GitHub issue';
        const number = issue.number;
        const evidenceId = stableId(this.name, 'evidence', `${htmlUrl}:${number ?? ''}`);
        const capturedAt = asProviderString(issue.updated_at) ?? asProviderString(issue.created_at) ?? context.now;
        evidence.push({
          id: evidenceId,
          kind: 'external_url',
          title,
          ...(capturedAt ? { capturedAt } : {}),
          source: this.name,
          url: htmlUrl,
          label: `${input.repository ?? 'search'}#${number ?? 'result'}`,
          metadata: {
            state: asProviderString(issue.state) ?? 'open',
            ...((input.repository ?? asProviderString(issue.repository_url)) ? { repository: input.repository ?? asProviderString(issue.repository_url) ?? '' } : {}),
            ...(asProviderString(asProviderRecord(issue.user)?.login) ? { author: asProviderString(asProviderRecord(issue.user)?.login) ?? '' } : {}),
            isPullRequest: Boolean(asProviderRecord(issue.pull_request)),
          },
        });

        const issueEntities: EntityExtractionResult[] = [];
        const repository = input.repository ?? asProviderString(issue.repository_url)?.split('/repos/')[1];
        if (repository) {
          issueEntities.push(createEntity(this.name, 'repository', repository, repository, [evidenceId], 0.92));
        }
        const author = asProviderString(asProviderRecord(issue.user)?.login);
        if (author) {
          issueEntities.push(createEntity(this.name, 'user', author, author, [evidenceId], 0.83));
        }
        entities.push(...issueEntities);

        signals.push(
          createSignal(
            this.name,
            asProviderRecord(issue.pull_request) ? 'change_event' : 'observation',
            `github:${title}`,
            {
              ...(typeof number === 'number' ? { number } : {}),
              state: asProviderString(issue.state) ?? 'open',
              comments: typeof issue.comments === 'number' ? issue.comments : 0,
            },
            issueEntities.map((entity) => entity.id),
            [evidenceId],
            stableConfidence(undefined, 0.78),
            ['provider:github'],
          ),
        );
      }

      return {
        tool: this.name,
        status: 'success',
        output: {
          signals: dedupeById(signals),
          entities: dedupeById(entities),
          evidence: dedupeById(evidence),
          summary: `Parsed ${items.length} GitHub item${items.length === 1 ? '' : 's'}.`,
        },
      };
    } catch (error) {
      return {
        tool: this.name,
        status: 'error',
        error: createToolExecutionError(this.name, error),
      };
    }
  }
}
