import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarketQueryDto {
  @ApiPropertyOptional({ default: 'BIST', maxLength: 32 })
  market?: string;

  @ApiPropertyOptional({ default: '1d', maxLength: 16 })
  timeframe?: string;
}

export class MarketRankingQueryDto extends MarketQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  limit?: string;

  @ApiPropertyOptional({ description: 'Opaque versioned keyset cursor' })
  cursor?: string;
}

export class MarketResponseMetaDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({ format: 'uuid' }) generationId!: string;
  @ApiProperty() marketCode!: string;
  @ApiProperty() timeframe!: string;
  @ApiProperty() universeVersion!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty({ format: 'date-time' }) dataCutoffAt!: string;
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  sourceTimestamp!: string | null;
  @ApiProperty({ enum: ['complete', 'partial', 'stale', 'notEvaluable'] })
  status!: string;
  @ApiProperty() partial!: boolean;
  @ApiProperty() stale!: boolean;
  @ApiProperty({ minimum: 0 }) evaluatedCount!: number;
  @ApiProperty({ minimum: 0 }) excludedCount!: number;
}

export class MarketOverviewResponseDto {
  @ApiProperty({ type: Object }) data!: Record<string, unknown>;
  @ApiProperty({ type: MarketResponseMetaDto }) meta!: MarketResponseMetaDto;
}

export class MarketBreadthResponseDto extends MarketOverviewResponseDto {}
export class MarketSectorsResponseDto extends MarketOverviewResponseDto {}
export class MarketRankingResponseDto extends MarketOverviewResponseDto {}
