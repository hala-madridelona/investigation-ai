import type {
  BaseToolOutput,
  EntityExtractionResult,
  EvidenceReference,
  FirestoreToolInput,
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
  toProviderJsonValue,
  extractProviderResponse,
  fetchJson,
  stableConfidence,
  stableId,
  StubToolAdapter,
} from './base.js';

const buildFirestoreUrl = (projectId: string, databaseId: string, path?: string): string => {
  const suffix = path ? `/${path.replace(/^\/+/, '')}` : '';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents${suffix}`;
};

const flattenFirestoreFields = (fields: Record<string, unknown>): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const record = asProviderRecord(value);
    output[key] =
      record?.stringValue ??
      record?.integerValue ??
      record?.doubleValue ??
      record?.booleanValue ??
      record?.timestampValue ??
      record?.referenceValue ??
      record?.nullValue ??
      record?.mapValue ??
      record?.arrayValue ??
      value;
  }
  return output;
};

export class FirestoreAdapter extends StubToolAdapter<FirestoreToolInput, BaseToolOutput> {
  readonly name = 'firestore' as const;

  protected async executeWithProvider(
    input: FirestoreToolInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<BaseToolOutput>> {
    try {
      const response = await extractProviderResponse(this.name, input, context, async () => {
        const metadata = asProviderRecord(context.metadata);
        const projectId = asProviderString(metadata?.gcpProjectId) ?? asProviderString(metadata?.projectId);
        const databaseId = asProviderString(metadata?.firestoreDatabaseId) ?? '(default)';
        const accessToken = asProviderString(metadata?.accessToken);
        if (!projectId || !accessToken) {
          throw {
            status: 400,
            message: 'firestore requires metadata.gcpProjectId and metadata.accessToken when no providerResponse is supplied.',
          };
        }
        return fetchJson(buildFirestoreUrl(projectId, databaseId, input.documentPath ?? input.collectionPath), {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      });

      const record = asProviderRecord(response);
      const documents = record?.documents ? asProviderArray(record.documents) : [response];
      const evidence: EvidenceReference[] = [];
      const entities: EntityExtractionResult[] = [];
      const signals: ToolSignal[] = [];

      for (const document of documents) {
        const doc = asProviderRecord(document);
        if (!doc) continue;
        const name = asProviderString(doc.name) ?? 'unknown-document';
        const evidenceId = stableId(this.name, 'evidence', name);
        const fields = flattenFirestoreFields(asProviderRecord(doc.fields) ?? {});
        const capturedAt = asProviderString(doc.updateTime) ?? asProviderString(doc.createTime) ?? context.now;
        evidence.push({
          id: evidenceId,
          kind: 'query',
          title: `Firestore document ${name.split('/').pop() ?? name}`,
          ...(capturedAt ? { capturedAt } : {}),
          source: this.name,
          queryLanguage: 'firestore-rest',
          queryText: input.documentPath ?? input.collectionPath ?? input.query,
          metadata: {
            documentName: name,
            fields: toProviderJsonValue(fields),
          },
        });

        const docEntities: EntityExtractionResult[] = [
          createEntity(this.name, 'document', name, name.split('/').pop() ?? name, [evidenceId], 0.94, {
            collectionPath: input.collectionPath ?? null,
          }),
        ];
        const repository = asProviderString(fields.repository) ?? asProviderString(fields.repo);
        if (repository) {
          docEntities.push(createEntity(this.name, 'repository', repository, repository, [evidenceId], 0.8));
        }
        const userId = asProviderString(fields.userId) ?? asProviderString(fields.user);
        if (userId) {
          docEntities.push(createEntity(this.name, 'user', userId, userId, [evidenceId], 0.76));
        }
        entities.push(...docEntities);

        signals.push(
          createSignal(
            this.name,
            'observation',
            `document:${name.split('/').pop() ?? name}`,
            {
              fieldCount: Object.keys(fields).length,
              hasQueryMatch:
                input.query.length === 0 || JSON.stringify(fields).toLowerCase().includes(input.query.toLowerCase()),
            },
            docEntities.map((entity) => entity.id),
            [evidenceId],
            stableConfidence(undefined, 0.74),
            ['provider:firestore'],
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
          summary: `Parsed ${documents.length} Firestore document${documents.length === 1 ? '' : 's'}.`,
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
