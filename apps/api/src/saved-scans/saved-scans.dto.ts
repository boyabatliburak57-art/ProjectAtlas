import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSavedScanDto {
  @ApiProperty({ maxLength: 160 })
  name!: string;

  @ApiPropertyOptional({ maxLength: 4_000, nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  tags?: string[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  rule!: Readonly<Record<string, unknown>>;
}

export class UpdateSavedScanDto {
  @ApiProperty({ minimum: 1 })
  expectedRevision!: number;

  @ApiPropertyOptional({ maxLength: 160 })
  name?: string;

  @ApiPropertyOptional({ maxLength: 4_000, nullable: true })
  description?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  tags?: string[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  rule?: Readonly<Record<string, unknown>>;
}

export class SavedScansQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  includeDeleted?: string;
}

export class SavedScanRevisionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  savedScanId!: string;

  @ApiProperty()
  revision!: number;

  @ApiProperty()
  ruleVersion!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  rule!: Readonly<Record<string, unknown>>;

  @ApiProperty()
  complexityScore!: number;

  @ApiProperty({ format: 'uuid' })
  createdBy!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class SavedScanDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  ownerUserId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['private'] })
  visibility!: 'private';

  @ApiProperty({ enum: ['active', 'deleted'] })
  status!: string;

  @ApiProperty()
  currentRevision!: number;

  @ApiProperty({ type: [String] })
  tags!: readonly string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deletedAt!: string | null;

  @ApiProperty({ type: SavedScanRevisionDto })
  revision!: SavedScanRevisionDto;
}

export class SavedScanResponseDto {
  @ApiProperty({ type: SavedScanDto })
  data!: SavedScanDto;

  @ApiProperty({ type: 'object', additionalProperties: true })
  meta!: { requestId: string };
}

export class SavedScanListResponseDto {
  @ApiProperty({ type: [SavedScanDto] })
  data!: SavedScanDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  meta!: { requestId: string };
}

export class SavedScanRevisionsResponseDto {
  @ApiProperty({ type: [SavedScanRevisionDto] })
  data!: SavedScanRevisionDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  meta!: { requestId: string };
}
