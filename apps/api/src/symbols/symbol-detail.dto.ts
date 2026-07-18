import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SymbolChartQueryDto {
  @ApiPropertyOptional({ enum: ['5m', '15m', '1h', '1d', '1w'], default: '1d' })
  timeframe?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 2000, default: 500 })
  limit?: string;

  @ApiPropertyOptional({
    enum: ['raw', 'split-adjusted', 'total-return'],
    default: 'raw',
  })
  adjustmentMode?: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated indicators. Syntax: volume,SMA@1(period=20),MACD@1',
  })
  overlays?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  includePatterns?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  includeCorporateActions?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false' })
  includeUserMarkers?: string;
}

export class SymbolResponseDto {
  @ApiProperty({ type: Object }) data!: Record<string, unknown>;
  @ApiProperty({ type: Object }) meta!: Record<string, unknown>;
}
