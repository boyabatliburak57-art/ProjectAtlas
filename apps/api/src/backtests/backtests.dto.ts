import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StrategyCreateDto {
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty({ type: Object }) definition!: Record<string, unknown>;
  @ApiPropertyOptional({ enum: ['draft', 'validated'] }) status?: string;
}

export class StrategyUpdateDto {
  @ApiProperty() expectedRevision!: number;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiPropertyOptional({ type: Object }) definition?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: ['draft', 'validated'] }) status?: string;
}

export class StrategyValidateDto {
  @ApiProperty({ type: Object }) definition!: Record<string, unknown>;
}

export class ListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 }) limit?: number;
  @ApiPropertyOptional({ description: 'Opaque versioned cursor' })
  cursor?: string;
  @ApiPropertyOptional() status?: string;
}

export class StrategyListQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] }) includeDeleted?: string;
}

export class BacktestCreateDto {
  @ApiProperty() strategyId!: string;
  @ApiProperty() strategyRevision!: number;
  @ApiProperty({ type: Object }) executionPlan!: Record<string, unknown>;
  @ApiProperty() dataSnapshotHash!: string;
  @ApiProperty() rangeFrom!: string;
  @ApiProperty() rangeTo!: string;
  @ApiProperty() complexityScore!: number;
}

export class SeriesQueryDto {
  @ApiProperty({
    enum: ['equity', 'drawdown', 'cash', 'exposure', 'benchmark'],
  })
  type!: string;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5000 }) limit?: number;
  @ApiPropertyOptional({ enum: ['raw', 'daily', 'weekly'] })
  resolution?: string;
}

export class TradesQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) instrumentId?: string;
  @ApiPropertyOptional({ enum: ['closedAt:desc'] }) sort?: string;
}

export class ExperimentCreateDto {
  @ApiProperty() name!: string;
  @ApiProperty() strategyId!: string;
  @ApiProperty() strategyRevision!: number;
  @ApiProperty() dataSnapshotId!: string;
  @ApiProperty() dataSnapshotHash!: string;
  @ApiProperty({ type: Object }) definition!: Record<string, unknown>;
}

export class ApiDataResponseDto {
  @ApiProperty({ type: Object }) data!: unknown;
  @ApiProperty({ type: Object }) meta!: Record<string, unknown>;
}

export class BacktestMetricDto {
  @ApiPropertyOptional({ nullable: true, type: String }) value!: string | null;
  @ApiProperty({ enum: ['complete', 'notEvaluable'] }) status!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  reasonCode!: string | null;
  @ApiProperty() observationCount!: number;
  @ApiProperty() methodologyVersion!: string;
  @ApiProperty({ type: [String] }) warnings!: string[];
}

export class BacktestMetricSetDto {
  @ApiProperty({ type: BacktestMetricDto }) totalReturn!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto })
  annualizedReturn!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto })
  annualizedVolatility!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) sharpeRatio!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) sortinoRatio!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) calmarRatio!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) expectancy!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) profitFactor!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) turnover!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) benchmarkReturn!: BacktestMetricDto;
  @ApiProperty({ type: BacktestMetricDto }) excessReturn!: BacktestMetricDto;
}

export class BacktestSummaryDto {
  @ApiProperty() endingEquity!: string;
  @ApiProperty() totalReturn!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  annualizedReturn!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  annualizedVolatility!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sharpe!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) sortino!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, type: String }) calmar!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  expectancy!: string | null;
  @ApiProperty() turnover!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  benchmarkReturn!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  excessReturn!: string | null;
  @ApiProperty({ type: BacktestMetricSetDto }) metrics!: BacktestMetricSetDto;
  @ApiProperty({ type: Object }) methodology!: Record<string, unknown>;
}

export class BacktestSummaryResponseDto {
  @ApiProperty({ type: BacktestSummaryDto }) data!: BacktestSummaryDto;
  @ApiProperty({ type: Object }) meta!: Record<string, unknown>;
}
