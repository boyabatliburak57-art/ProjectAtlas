import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScanRunDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  rule!: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ minimum: 1, maximum: 10_000 })
  requestedHistoryBars?: number;

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['saved_scan'] },
      id: { type: 'string', format: 'uuid' },
      revision: { type: 'integer', minimum: 1 },
    },
  })
  source?: {
    readonly type: 'saved_scan';
    readonly id: string;
    readonly revision: number;
  };
}

export class ScanRunResultsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  limit?: string;

  @ApiPropertyOptional({ description: 'Opaque pagination cursor' })
  cursor?: string;

  @ApiPropertyOptional({ enum: ['matched', 'notEvaluable'] })
  status?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'rank'], default: 'createdAt' })
  sort?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  direction?: string;

  @ApiPropertyOptional({ default: false })
  includeExplanation?: string;
}

export class ScanRunProgressDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  processed!: number;

  @ApiProperty()
  matched!: number;

  @ApiProperty()
  notEvaluable!: number;

  @ApiProperty()
  warnings!: number;

  @ApiProperty()
  phase!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty()
  percent!: number;
}

export class ScanRunDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: [
      'queued',
      'running',
      'completed',
      'failed',
      'cancelRequested',
      'cancelled',
      'expired',
    ],
  })
  status!: string;

  @ApiProperty({ enum: ['sync', 'async'] })
  executionMode!: string;

  @ApiProperty()
  planVersion!: number;

  @ApiProperty()
  ruleVersion!: number;

  @ApiProperty({ format: 'date-time' })
  dataCutoffAt!: string;

  @ApiProperty({ format: 'date-time' })
  queuedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  startedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelRequestedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  timeoutAt!: string | null;

  @ApiProperty({ type: ScanRunProgressDto })
  progress!: ScanRunProgressDto;

  @ApiPropertyOptional({ nullable: true })
  errorCode!: string | null;
}

export class ScanRunResponseMetaDto {
  @ApiProperty()
  requestId!: string;

  @ApiPropertyOptional()
  nextCursor?: string | null;

  @ApiPropertyOptional()
  replayed?: boolean;
}

export class ScanRunResponseDto {
  @ApiProperty({ type: ScanRunDto })
  data!: ScanRunDto;

  @ApiProperty({ type: ScanRunResponseMetaDto })
  meta!: ScanRunResponseMetaDto;
}

export class ScanResultDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'uuid' })
  instrumentId!: string;

  @ApiPropertyOptional({ nullable: true })
  rank!: number | null;

  @ApiProperty({ enum: ['matched', 'notEvaluable'] })
  status!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  computedValues!: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  explanation?: Readonly<Record<string, unknown>>;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  warnings!: readonly Readonly<Record<string, unknown>>[];

  @ApiProperty({ format: 'date-time' })
  dataCutoffAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  matchedAt!: string | null;

  @ApiProperty()
  sourceBatchIndex!: number;

  @ApiProperty()
  resultVersion!: number;
}

export class ScanResultsDataDto {
  @ApiProperty({ type: [ScanResultDto] })
  items!: ScanResultDto[];
}

export class ScanResultsResponseDto {
  @ApiProperty({ type: ScanResultsDataDto })
  data!: ScanResultsDataDto;

  @ApiProperty({ type: ScanRunResponseMetaDto })
  meta!: ScanRunResponseMetaDto;
}
