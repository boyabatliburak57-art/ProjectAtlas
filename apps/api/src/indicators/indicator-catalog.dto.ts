import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INDICATOR_CATEGORIES = [
  'price',
  'momentum',
  'trend',
  'volatility',
  'volume',
] as const;

export class IndicatorCatalogQueryDto {
  @ApiPropertyOptional({ enum: INDICATOR_CATEGORIES })
  category?: string;

  @ApiPropertyOptional({ enum: ['enabled', 'disabled'] })
  status?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  search?: string;
}

export class IndicatorCatalogItemDto {
  @ApiProperty({ example: 'RSI' })
  code!: string;

  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ example: 'Relative Strength Index' })
  name!: string;

  @ApiProperty({ enum: INDICATOR_CATEGORIES })
  category!: string;

  @ApiProperty({ enum: ['enabled'] })
  status!: 'enabled';

  @ApiProperty({ type: 'object', additionalProperties: true })
  parameters!: Readonly<Record<string, unknown>>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  output!: Readonly<Record<string, unknown>>;
}

export class IndicatorCatalogListDataDto {
  @ApiProperty({ type: [IndicatorCatalogItemDto] })
  items!: IndicatorCatalogItemDto[];

  @ApiProperty({ example: 20 })
  total!: number;
}

export class ResponseMetaDto {
  @ApiProperty()
  requestId!: string;
}

export class IndicatorCatalogListResponseDto {
  @ApiProperty({ type: IndicatorCatalogListDataDto })
  data!: IndicatorCatalogListDataDto;

  @ApiProperty({ type: ResponseMetaDto })
  meta!: ResponseMetaDto;
}

export class IndicatorCatalogDetailDataDto {
  @ApiProperty({ example: 'RSI' })
  code!: string;

  @ApiProperty({ example: 'Relative Strength Index' })
  name!: string;

  @ApiProperty({ enum: INDICATOR_CATEGORIES })
  category!: string;

  @ApiProperty({ example: 1 })
  defaultVersion!: number;

  @ApiProperty({ type: [IndicatorCatalogItemDto] })
  versions!: IndicatorCatalogItemDto[];
}

export class IndicatorCatalogDetailResponseDto {
  @ApiProperty({ type: IndicatorCatalogDetailDataDto })
  data!: IndicatorCatalogDetailDataDto;

  @ApiProperty({ type: ResponseMetaDto })
  meta!: ResponseMetaDto;
}
