import type { ScanRuleAst } from '../ast/contracts.js';

export type SavedScanStatus = 'active' | 'deleted';

export interface SavedScanRevision {
  readonly id: string;
  readonly savedScanId: string;
  readonly revision: number;
  readonly ruleVersion: number;
  readonly rule: ScanRuleAst;
  readonly complexityScore: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface SavedScan {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly description: string | null;
  readonly visibility: 'private';
  readonly status: SavedScanStatus;
  readonly currentRevision: number;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface SavedScanWithRevision extends SavedScan {
  readonly revision: SavedScanRevision;
}

export interface NewSavedScan {
  readonly ownerUserId: string;
  readonly name: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly rule: ScanRuleAst;
  readonly complexityScore: number;
  readonly createdBy: string;
  readonly now: Date;
  readonly clonedFrom?:
    | {
        readonly savedScanId: string;
        readonly revision: number;
      }
    | undefined;
}

export interface ReviseSavedScan {
  readonly id: string;
  readonly ownerUserId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly rule: ScanRuleAst;
  readonly complexityScore: number;
  readonly createdBy: string;
  readonly now: Date;
}

export type ReviseSavedScanResult =
  | { readonly outcome: 'updated'; readonly scan: SavedScanWithRevision }
  | { readonly outcome: 'conflict' };

export interface SavedScanRepository {
  listOwned(
    ownerUserId: string,
    includeDeleted: boolean,
  ): Promise<readonly SavedScanWithRevision[]>;
  findById(id: string): Promise<SavedScanWithRevision | null>;
  listRevisions(id: string): Promise<readonly SavedScanRevision[]>;
  create(input: NewSavedScan): Promise<SavedScanWithRevision>;
  revise(input: ReviseSavedScan): Promise<ReviseSavedScanResult>;
  softDelete(
    id: string,
    ownerUserId: string,
    now: Date,
  ): Promise<SavedScanWithRevision | null>;
  restore(
    id: string,
    ownerUserId: string,
    now: Date,
  ): Promise<SavedScanWithRevision | null>;
}

export type SavedScanQuotaOperation = 'create' | 'revision' | 'clone';

export interface SavedScanQuotaPort {
  check(input: {
    readonly userId: string;
    readonly operation: SavedScanQuotaOperation;
    readonly savedScanId?: string | undefined;
  }): Promise<{
    readonly allowed: boolean;
    readonly reasonCode?: string | undefined;
  }>;
}

export interface SavedScanApplicationDependencies {
  readonly repository: SavedScanRepository;
  readonly quota: SavedScanQuotaPort;
  readonly now?: (() => Date) | undefined;
}
