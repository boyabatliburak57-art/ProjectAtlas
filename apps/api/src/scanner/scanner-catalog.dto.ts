import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScanOperatorDto {
  @ApiProperty()
  code!: string;

  @ApiProperty({ minimum: 1, maximum: 3 })
  arity!: number;

  @ApiProperty({ enum: ['number', 'boolean'] })
  valueType!: string;

  @ApiProperty({ enum: ['none', 'previous', 'period'] })
  historyRequirement!: string;

  @ApiPropertyOptional({ enum: ['period', 'percent'] })
  requiredOption?: string | undefined;
}

export class ScanOperatorListResponseDto {
  @ApiProperty({ type: [ScanOperatorDto] })
  data!: ScanOperatorDto[];

  @ApiProperty({
    type: 'object',
    properties: { requestId: { type: 'string' } },
  })
  meta!: { requestId: string };
}

export class ValidateScanDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  rule!: Readonly<Record<string, unknown>>;

  @ApiPropertyOptional({ minimum: 1, maximum: 100_000, default: 100 })
  universeInstrumentCount?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10_000, default: 1 })
  requestedHistoryBars?: number;
}

export class ScanValidationResponseDto {
  @ApiProperty()
  data!: Readonly<Record<string, unknown>>;

  @ApiProperty({
    type: 'object',
    properties: { requestId: { type: 'string' } },
  })
  meta!: { requestId: string };
}
