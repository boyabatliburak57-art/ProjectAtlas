import type { ScanRuleAst, ScanRuleNode } from '../ast/contracts.js';
import { validateScanRule } from '../validation/scan-rule-validator.js';
import type {
  SavedScanApplicationDependencies,
  SavedScanQuotaOperation,
  SavedScanWithRevision,
} from './contracts.js';
import { SavedScanError } from './errors.js';

export interface CreateSavedScanRequest {
  readonly userId: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly rule: unknown;
}

export interface UpdateSavedScanRequest {
  readonly userId: string;
  readonly id: string;
  readonly expectedRevision: number;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly rule?: unknown;
}

export class SavedScanApplicationService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: SavedScanApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  list(userId: string, includeDeleted = false) {
    return this.dependencies.repository.listOwned(userId, includeDeleted);
  }

  async get(userId: string, id: string): Promise<SavedScanWithRevision> {
    return this.requireOwned(userId, id);
  }

  async revisions(userId: string, id: string) {
    await this.requireOwned(userId, id);
    return this.dependencies.repository.listRevisions(id);
  }

  async create(
    request: CreateSavedScanRequest,
  ): Promise<SavedScanWithRevision> {
    await this.checkQuota(request.userId, 'create');
    const rule = parseRule(request.rule);
    return this.dependencies.repository.create({
      ownerUserId: request.userId,
      name: normalizeName(request.name),
      description: normalizeDescription(request.description),
      tags: normalizeTags(request.tags),
      rule,
      complexityScore: complexity(rule),
      createdBy: request.userId,
      now: this.now(),
    });
  }

  async update(
    request: UpdateSavedScanRequest,
  ): Promise<SavedScanWithRevision> {
    const existing = await this.requireOwned(request.userId, request.id);
    if (existing.status === 'deleted')
      throw new SavedScanError('SAVED_SCAN_DELETED');
    await this.checkQuota(request.userId, 'revision', request.id);
    const rule =
      request.rule === undefined
        ? existing.revision.rule
        : parseRule(request.rule);
    const revised = await this.dependencies.repository.revise({
      id: request.id,
      ownerUserId: request.userId,
      expectedRevision: request.expectedRevision,
      name:
        request.name === undefined
          ? existing.name
          : normalizeName(request.name),
      description:
        request.description === undefined
          ? existing.description
          : normalizeDescription(request.description),
      tags:
        request.tags === undefined
          ? existing.tags
          : normalizeTags(request.tags),
      rule,
      complexityScore: complexity(rule),
      createdBy: request.userId,
      now: this.now(),
    });
    if (revised.outcome === 'conflict')
      throw new SavedScanError('SAVED_SCAN_CONFLICT');
    return revised.scan;
  }

  async delete(userId: string, id: string): Promise<SavedScanWithRevision> {
    const existing = await this.requireOwned(userId, id);
    if (existing.status === 'deleted') return existing;
    const deleted = await this.dependencies.repository.softDelete(
      id,
      userId,
      this.now(),
    );
    if (deleted === null) throw new SavedScanError('SAVED_SCAN_CONFLICT');
    return deleted;
  }

  async restore(userId: string, id: string): Promise<SavedScanWithRevision> {
    const existing = await this.requireOwned(userId, id);
    if (existing.status === 'active') return existing;
    const restored = await this.dependencies.repository.restore(
      id,
      userId,
      this.now(),
    );
    if (restored === null) throw new SavedScanError('SAVED_SCAN_CONFLICT');
    return restored;
  }

  async clone(userId: string, id: string): Promise<SavedScanWithRevision> {
    const source = await this.requireOwned(userId, id);
    if (source.status === 'deleted')
      throw new SavedScanError('SAVED_SCAN_DELETED');
    await this.checkQuota(userId, 'clone', id);
    return this.dependencies.repository.create({
      ownerUserId: userId,
      name: normalizeName(`${source.name} (Copy)`),
      description: source.description,
      tags: source.tags,
      rule: source.revision.rule,
      complexityScore: source.revision.complexityScore,
      createdBy: userId,
      now: this.now(),
      clonedFrom: { savedScanId: source.id, revision: source.currentRevision },
    });
  }

  private async requireOwned(
    userId: string,
    id: string,
  ): Promise<SavedScanWithRevision> {
    const scan = await this.dependencies.repository.findById(id);
    if (scan === null) throw new SavedScanError('SAVED_SCAN_NOT_FOUND');
    if (scan.ownerUserId !== userId)
      throw new SavedScanError('SAVED_SCAN_ACCESS_DENIED');
    return scan;
  }

  private async checkQuota(
    userId: string,
    operation: SavedScanQuotaOperation,
    savedScanId?: string,
  ) {
    const result = await this.dependencies.quota.check({
      userId,
      operation,
      ...(savedScanId === undefined ? {} : { savedScanId }),
    });
    if (!result.allowed) {
      throw new SavedScanError('SAVED_SCAN_QUOTA_EXCEEDED', {
        reasonCode: result.reasonCode ?? 'LIMIT_EXCEEDED',
      });
    }
  }
}

function parseRule(value: unknown): ScanRuleAst {
  const result = validateScanRule(value);
  if (!result.valid || result.normalizedRule === undefined) {
    throw new SavedScanError('SAVED_SCAN_INVALID', {
      validationErrors: result.errors,
    });
  }
  return result.normalizedRule;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (name.length === 0 || name.length > 160)
    throw new SavedScanError('SAVED_SCAN_INVALID');
  return name;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const description = value.trim();
  if (description.length > 4_000)
    throw new SavedScanError('SAVED_SCAN_INVALID');
  return description === '' ? null : description;
}

function normalizeTags(
  values: readonly string[] | undefined,
): readonly string[] {
  if (values === undefined) return [];
  const tags = [
    ...new Set(values.map((tag) => tag.trim().toLowerCase())),
  ].sort();
  if (
    tags.length > 20 ||
    tags.some((tag) => tag.length === 0 || tag.length > 64)
  ) {
    throw new SavedScanError('SAVED_SCAN_INVALID');
  }
  return tags;
}

function complexity(rule: ScanRuleAst): number {
  const count = (node: ScanRuleNode): number =>
    node.type === 'condition'
      ? 1
      : 1 + node.children.reduce((total, child) => total + count(child), 0);
  return count(rule.root);
}
