'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { AtlasShell, WorkspaceState } from '@/features/portfolio/atlas-shell';

import { safeLabError, strategyLabApi } from './api';
import type {
  BacktestRun,
  BacktestSummary,
  SeriesPoint,
  StrategyConditionDraft,
  StrategyDefinition,
  StrategyValidation,
} from './types';

const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);
const runStages = [
  'Doğrulama',
  'Evren çözümü',
  'Point-in-time veri',
  'İndikatör ısınması',
  'Simülasyon',
  'Metrikler',
  'Kalıcılaştırma',
  'Sonlandırma',
];

function key() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function StrategyLabShell({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <AtlasShell>
      <div className="lab-context-bar">
        <Link href="/strategies">Stratejiler</Link>
        <Link href="/backtests">Backtestler</Link>
        <Link href="/experiments">Deneyler</Link>
        <span>Kapalı bar · point-in-time · deterministik</span>
      </div>
      {children}
    </AtlasShell>
  );
}

export function StrategiesWorkspace() {
  const queryClient = useQueryClient();
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const strategies = useQuery({
    queryKey: ['strategies', includeDeleted],
    queryFn: () => strategyLabApi.strategies(includeDeleted),
  });
  const archive = useMutation({
    mutationFn: strategyLabApi.archiveStrategy,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  });
  const clone = useMutation({
    mutationFn: strategyLabApi.cloneStrategy,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['strategies'] }),
  });
  return (
    <StrategyLabShell>
      <main className="lab-main">
        <LabHeading
          eyebrow="Strategy registry"
          title="Fikri, kanıta bağla."
          copy="Kuralların her değişimini immutable revision olarak saklayın; çalıştırmadan önce veri ihtiyacını ve bias riskini görün."
          action={
            <Link className="button primary" href="/strategies/new">
              Yeni strateji
            </Link>
          }
        />
        <PastPerformanceWarning />
        <div className="lab-toolbar">
          <label className="check-line">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(event) => setIncludeDeleted(event.target.checked)}
            />
            Arşivlenenleri göster
          </label>
          <span>{strategies.data?.length ?? 0} strategy</span>
        </div>
        {strategies.isLoading && (
          <WorkspaceState kind="loading">
            Stratejiler yükleniyor…
          </WorkspaceState>
        )}
        {strategies.isError && (
          <WorkspaceState kind="error">
            {safeLabError(strategies.error)}
          </WorkspaceState>
        )}
        {strategies.data?.length === 0 && (
          <WorkspaceState kind="empty">
            İlk stratejinizi oluşturarak araştırma kaydını başlatın.
          </WorkspaceState>
        )}
        <div className="strategy-ledger">
          {strategies.data?.map((strategy) => (
            <article key={strategy.id} className="strategy-row">
              <div>
                <p className="rail-label">
                  REV {strategy.currentRevision} · {strategy.status}
                </p>
                <h2>
                  <Link href={`/strategies/${strategy.id}`}>
                    {strategy.name}
                  </Link>
                </h2>
                <p>{strategy.description ?? 'Açıklama eklenmedi.'}</p>
              </div>
              <dl>
                <div>
                  <dt>Timeframe</dt>
                  <dd>{String(strategy.revision.definition.baseTimeframe)}</dd>
                </div>
                <div>
                  <dt>Benchmark</dt>
                  <dd>{strategy.revision.definition.benchmarkCode ?? 'Yok'}</dd>
                </div>
                <div>
                  <dt>Doğrulama</dt>
                  <dd>
                    {strategy.revision.validation.valid ? 'Geçti' : 'Taslak'}
                  </dd>
                </div>
              </dl>
              <div className="row-actions">
                <Link
                  className="button ghost"
                  href={`/backtests?strategyId=${strategy.id}`}
                >
                  Backtest
                </Link>
                <button
                  type="button"
                  className="button ghost"
                  disabled={clone.isPending}
                  onClick={() => clone.mutate(strategy.id)}
                >
                  Klonla
                </button>
                {strategy.status !== 'deleted' && (
                  <button
                    type="button"
                    className="button danger"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(strategy.id)}
                  >
                    Arşivle
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </main>
    </StrategyLabShell>
  );
}

export function StrategyEditorWorkspace({
  strategyId,
}: {
  readonly strategyId?: string;
}) {
  const router = useRouter();
  const existing = useQuery({
    queryKey: ['strategy', strategyId],
    queryFn: () => strategyLabApi.strategy(strategyId!),
    enabled: Boolean(strategyId),
    retry: false,
  });
  const [name, setName] = useState('RSI dönüş stratejisi');
  const [description, setDescription] = useState(
    'Aktif BIST paylarında momentum dönüşü.',
  );
  const [indexCodes, setIndexCodes] = useState('XU100');
  const [entry, setEntry] = useState<StrategyConditionDraft[]>([
    condition('RSI', 'LT', 35),
  ]);
  const [exit, setExit] = useState<StrategyConditionDraft[]>([
    condition('RSI', 'GT', 60),
  ]);
  const [sizing, setSizing] = useState<
    'equalWeight' | 'fixedCash' | 'fixedPercent'
  >('equalWeight');
  const [sizeValue, setSizeValue] = useState(10_000);
  const [stopLoss, setStopLoss] = useState(5);
  const [takeProfit, setTakeProfit] = useState(15);
  const [maxPositions, setMaxPositions] = useState(5);
  const [execution, setExecution] = useState<
    'closed_bar_next_open' | 'same_bar_close_research'
  >('closed_bar_next_open');
  const [costFree, setCostFree] = useState(false);
  const [commission, setCommission] = useState(0.1);
  const [slippage, setSlippage] = useState(5);
  const [benchmark, setBenchmark] = useState('XU100');
  const [parameterName, setParameterName] = useState('entryThreshold');
  const [validation, setValidation] = useState<StrategyValidation | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!existing.data || hydrated) return;
    const strategy = existing.data;
    const draft = editorDraft(strategy.revision.definition);
    setName(strategy.name);
    setDescription(strategy.description ?? '');
    setIndexCodes(draft.indexCodes);
    setEntry(draft.entry);
    setExit(draft.exit);
    setSizing(draft.sizing as 'equalWeight' | 'fixedCash' | 'fixedPercent');
    setSizeValue(draft.sizeValue);
    setStopLoss(draft.stopLoss);
    setTakeProfit(draft.takeProfit);
    setMaxPositions(draft.maxPositions);
    setExecution(draft.execution);
    setCostFree(draft.costFree);
    setCommission(draft.commission);
    setSlippage(draft.slippage);
    setBenchmark(strategy.revision.definition.benchmarkCode ?? '');
    setParameterName(draft.parameterName);
    setValidation(strategy.revision.validation);
    setHydrated(true);
  }, [existing.data, hydrated]);

  const definition = useMemo(
    () =>
      buildDefinition({
        indexCodes,
        entry,
        exit,
        sizing,
        sizeValue,
        stopLoss,
        takeProfit,
        maxPositions,
        execution,
        costFree,
        commission,
        slippage,
        benchmark,
        parameterName,
      }),
    [
      indexCodes,
      entry,
      exit,
      sizing,
      sizeValue,
      stopLoss,
      takeProfit,
      maxPositions,
      execution,
      costFree,
      commission,
      slippage,
      benchmark,
      parameterName,
    ],
  );
  const validate = useMutation({
    mutationFn: () => strategyLabApi.validate(definition),
    onSuccess: setValidation,
  });
  const save = useMutation({
    mutationFn: async () => {
      const result = await strategyLabApi.validate(definition);
      setValidation(result);
      if (!result.valid) throw new Error('STRATEGY_INVALID');
      return strategyId && existing.data
        ? strategyLabApi.reviseStrategy(strategyId, {
            expectedRevision: existing.data.currentRevision,
            name,
            description,
            definition,
            status: 'validated',
          })
        : strategyLabApi.createStrategy({
            name,
            description,
            definition,
            status: 'validated',
          });
    },
    onSuccess: (strategy) => router.push(`/strategies/${strategy.id}`),
  });
  const clone = useMutation({
    mutationFn: () => strategyLabApi.cloneStrategy(strategyId!),
    onSuccess: (strategy) => router.push(`/strategies/${strategy.id}`),
  });

  if (existing.isError)
    return (
      <StrategyLabShell>
        <main className="lab-main">
          <WorkspaceState kind="error">
            {safeLabError(existing.error)}
          </WorkspaceState>
        </main>
      </StrategyLabShell>
    );
  return (
    <StrategyLabShell>
      <main className="lab-main editor-main">
        <LabHeading
          eyebrow={
            strategyId
              ? `Revision ${existing.data?.currentRevision ?? '—'}`
              : 'New strategy'
          }
          title={strategyId ? name : 'Kuraldan araştırma protokolüne.'}
          copy="Entry ve exit AST, veri bütünlüğü, maliyet ve execution politikası tek revision içinde saklanır."
        />
        <PastPerformanceWarning />
        <div className="evidence-line" aria-label="Strategy kanıt hattı">
          <span className="active">01 Kural</span>
          <span>02 Doğrulama</span>
          <span>03 Revision</span>
          <span>04 Run</span>
        </div>
        <div className="strategy-editor-grid">
          <div className="editor-stack">
            <EditorSection title="Kimlik ve evren" note="Point-in-time üyelik">
              <div className="form-grid two">
                <label>
                  Strateji adı
                  <input
                    aria-label="Strateji adı"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  Endeks evreni
                  <input
                    aria-label="Endeks evreni"
                    value={indexCodes}
                    onChange={(event) =>
                      setIndexCodes(event.target.value.toUpperCase())
                    }
                  />
                </label>
              </div>
              <label>
                Açıklama
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <p className="inline-note">
                Aktif BIST araçları, tarihsel endeks üyeliğiyle çözülür. Bugünkü
                evren geçmişe uygulanmaz.
              </p>
            </EditorSection>
            <EditorSection
              title="Entry Rule Builder"
              note="Klavye ile tam erişilebilir"
            >
              <RuleBuilder
                kind="Entry"
                conditions={entry}
                onChange={setEntry}
              />
            </EditorSection>
            <EditorSection title="Exit Rule Builder" note="Kapalı bar sinyali">
              <RuleBuilder kind="Exit" conditions={exit} onChange={setExit} />
            </EditorSection>
            <EditorSection title="Sizing ve risk" note="Short/leverage kapalı">
              <div className="form-grid three">
                <label>
                  Pozisyon boyutu
                  <select
                    aria-label="Pozisyon boyutu"
                    value={sizing}
                    onChange={(event) =>
                      setSizing(event.target.value as typeof sizing)
                    }
                  >
                    <option value="equalWeight">Eşit ağırlık</option>
                    <option value="fixedCash">Sabit nakit</option>
                    <option value="fixedPercent">Sabit yüzde</option>
                  </select>
                </label>
                {sizing !== 'equalWeight' && (
                  <label>
                    {sizing === 'fixedCash' ? 'Tutar (TRY)' : 'Yüzde'}
                    <input
                      type="number"
                      value={sizeValue}
                      onChange={(event) =>
                        setSizeValue(event.target.valueAsNumber)
                      }
                    />
                  </label>
                )}
                <label>
                  Maks. pozisyon
                  <input
                    aria-label="Maksimum pozisyon"
                    type="number"
                    min={1}
                    value={maxPositions}
                    onChange={(event) =>
                      setMaxPositions(event.target.valueAsNumber)
                    }
                  />
                </label>
                <label>
                  Stop loss %
                  <input
                    type="number"
                    value={stopLoss}
                    onChange={(event) =>
                      setStopLoss(event.target.valueAsNumber)
                    }
                  />
                </label>
                <label>
                  Take profit %
                  <input
                    type="number"
                    value={takeProfit}
                    onChange={(event) =>
                      setTakeProfit(event.target.valueAsNumber)
                    }
                  />
                </label>
              </div>
            </EditorSection>
            <EditorSection
              title="Execution ve maliyet"
              note="Next-open varsayılan"
            >
              <div className="form-grid three">
                <label>
                  Execution
                  <select
                    aria-label="Execution modu"
                    value={execution}
                    onChange={(event) =>
                      setExecution(event.target.value as typeof execution)
                    }
                  >
                    <option value="closed_bar_next_open">
                      Closed bar → next open
                    </option>
                    <option value="same_bar_close_research">
                      Same-bar research
                    </option>
                  </select>
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={costFree}
                    onChange={(event) => setCostFree(event.target.checked)}
                  />
                  Maliyetsiz araştırma
                </label>
                {!costFree && (
                  <>
                    <label>
                      Komisyon %
                      <input
                        aria-label="Komisyon yüzdesi"
                        type="number"
                        step="0.01"
                        value={commission}
                        onChange={(event) =>
                          setCommission(event.target.valueAsNumber)
                        }
                      />
                    </label>
                    <label>
                      Slippage bps
                      <input
                        aria-label="Slippage bps"
                        type="number"
                        value={slippage}
                        onChange={(event) =>
                          setSlippage(event.target.valueAsNumber)
                        }
                      />
                    </label>
                  </>
                )}
                <label>
                  Benchmark
                  <input
                    aria-label="Benchmark"
                    value={benchmark}
                    onChange={(event) =>
                      setBenchmark(event.target.value.toUpperCase())
                    }
                  />
                </label>
              </div>
              {execution === 'same_bar_close_research' && (
                <Warning code="SAME-BAR">
                  Aynı bar execution, optimistic ve leakage’a açık bir araştırma
                  modudur.
                </Warning>
              )}
              {costFree && (
                <Warning code="COST-FREE">
                  Komisyon ve slippage yok sayılıyor; sonuçlar belirgin biçimde
                  iyimser olabilir.
                </Warning>
              )}
            </EditorSection>
            <EditorSection title="Parametreler" note="Deterministik binding">
              <label>
                İlk parametre adı
                <input
                  aria-label="Parametre adı"
                  value={parameterName}
                  onChange={(event) => setParameterName(event.target.value)}
                />
              </label>
              <p className="inline-note">
                Varsayılan 35 · aralık 0–100 · grid deneylerinde override
                edilebilir.
              </p>
            </EditorSection>
          </div>
          <aside className="validation-rail" aria-live="polite">
            <p className="rail-label">SERVER VALIDATION</p>
            <h2>
              {validation
                ? validation.valid
                  ? 'Çalıştırılabilir'
                  : 'Düzeltme gerekli'
                : 'Henüz doğrulanmadı'}
            </h2>
            {validation && (
              <>
                <dl className="validation-metrics">
                  <div>
                    <dt>Karmaşıklık</dt>
                    <dd>{validation.complexityScore}</dd>
                  </div>
                  <div>
                    <dt>Operasyon / araç</dt>
                    <dd>
                      {validation.workload.estimatedOperationsPerInstrument}
                    </dd>
                  </div>
                  <div>
                    <dt>Warm-up</dt>
                    <dd>{validation.warmup.maximumBars} bar</dd>
                  </div>
                  <div>
                    <dt>Koşul</dt>
                    <dd>{validation.workload.conditionCount}</dd>
                  </div>
                </dl>
                {validation.errors.map((error) => (
                  <p
                    className="validation-error"
                    role="alert"
                    key={`${error.path}-${error.code}`}
                  >
                    <strong>{error.code}</strong>
                    <br />
                    {error.path}
                  </p>
                ))}
                {validation.warnings.map((warning) => (
                  <Warning key={warning.code} code={warning.code}>
                    {warning.message}
                  </Warning>
                ))}
                <p className="inline-note">
                  Tarihsel evren:{' '}
                  {validation.requiredData.requiresHistoricalUniverse
                    ? 'zorunlu'
                    : 'hayır'}{' '}
                  · Corporate action:{' '}
                  {validation.requiredData.requiresCorporateActions
                    ? 'zorunlu'
                    : 'hayır'}
                </p>
              </>
            )}
            {(validate.isError || save.isError) && (
              <p role="alert" className="validation-error">
                {safeLabError(validate.error ?? save.error)}
              </p>
            )}
            <div className="rail-actions">
              <button
                type="button"
                className="button ghost"
                disabled={validate.isPending || save.isPending}
                onClick={() => validate.mutate()}
              >
                Sunucuda doğrula
              </button>
              <button
                type="button"
                className="button primary"
                disabled={save.isPending || validate.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending
                  ? 'Kaydediliyor…'
                  : strategyId
                    ? 'Yeni revision kaydet'
                    : 'Stratejiyi oluştur'}
              </button>
              {strategyId && (
                <button
                  type="button"
                  className="button ghost"
                  disabled={clone.isPending}
                  onClick={() => clone.mutate()}
                >
                  Stratejiyi klonla
                </button>
              )}
            </div>
          </aside>
        </div>
      </main>
    </StrategyLabShell>
  );
}

function RuleBuilder({
  kind,
  conditions,
  onChange,
}: {
  readonly kind: string;
  readonly conditions: StrategyConditionDraft[];
  readonly onChange: (value: StrategyConditionDraft[]) => void;
}) {
  const patch = (index: number, value: Partial<StrategyConditionDraft>) =>
    onChange(
      conditions.map((item, current) =>
        current === index ? { ...item, ...value } : item,
      ),
    );
  return (
    <div
      className="lab-rule-builder"
      role="group"
      aria-label={`${kind} kural grubu`}
    >
      <div className="logic-pill" aria-label={`${kind} grup mantığı`}>
        AND
      </div>
      {conditions.map((item, index) => (
        <div
          className="lab-condition"
          key={`${kind}-${index}`}
          tabIndex={0}
          aria-label={`${kind} koşul ${index + 1}`}
        >
          <span>{String(index + 1).padStart(2, '0')}</span>
          <label>
            İndikatör
            <select
              aria-label={`${kind} indikatör ${index + 1}`}
              value={item.indicator}
              onChange={(event) =>
                patch(index, {
                  indicator: event.target
                    .value as StrategyConditionDraft['indicator'],
                })
              }
            >
              <option>RSI</option>
              <option>EMA</option>
            </select>
          </label>
          <label>
            Periyot
            <input
              aria-label={`${kind} periyot ${index + 1}`}
              type="number"
              min={1}
              value={item.period}
              onChange={(event) =>
                patch(index, { period: event.target.valueAsNumber })
              }
            />
          </label>
          <label>
            Operatör
            <select
              aria-label={`${kind} operatör ${index + 1}`}
              value={item.operator}
              onChange={(event) =>
                patch(index, {
                  operator: event.target
                    .value as StrategyConditionDraft['operator'],
                })
              }
            >
              <option value="LT">Küçüktür</option>
              <option value="GT">Büyüktür</option>
              <option value="CROSSES_ABOVE">Yukarı keser</option>
              <option value="CROSSES_BELOW">Aşağı keser</option>
            </select>
          </label>
          <label>
            {item.operator.startsWith('CROSSES') ? 'Sağ EMA periyodu' : 'Değer'}
            <input
              aria-label={`${kind} değer ${index + 1}`}
              type="number"
              value={item.value}
              onChange={(event) =>
                patch(index, { value: event.target.valueAsNumber })
              }
            />
          </label>
          <button
            type="button"
            className="icon-action"
            aria-label={`${kind} koşul ${index + 1} sil`}
            disabled={conditions.length === 1}
            onClick={() =>
              onChange(conditions.filter((_, current) => current !== index))
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button ghost add-rule"
        onClick={() =>
          onChange([...conditions, condition('EMA', 'CROSSES_ABOVE', 50)])
        }
      >
        + Koşul ekle
      </button>
    </div>
  );
}

export function BacktestsWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const strategies = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategyLabApi.strategies(),
  });
  const runs = useQuery({
    queryKey: ['backtests'],
    queryFn: strategyLabApi.backtests,
    refetchInterval: (query) =>
      query.state.data?.some((run) => !terminal.has(run.status)) ? 1500 : false,
  });
  const [strategyId, setStrategyId] = useState(search.get('strategyId') ?? '');
  const [revision, setRevision] = useState(1);
  const [from, setFrom] = useState('2021-01-01');
  const [to, setTo] = useState('2025-12-31');
  const [capital, setCapital] = useState('100000');
  const [timeframe, setTimeframe] = useState('1d');
  const [adjustmentMode, setAdjustmentMode] = useState('splitAdjusted');
  const [override, setOverride] = useState('35');
  const revisions = useQuery({
    queryKey: ['strategy', strategyId, 'revisions'],
    queryFn: () => strategyLabApi.revisions(strategyId),
    enabled: Boolean(strategyId),
  });
  useEffect(() => {
    if (!strategyId && strategies.data?.[0]) {
      setStrategyId(strategies.data[0].id);
      setRevision(strategies.data[0].currentRevision);
    }
  }, [strategies.data, strategyId]);
  const create = useMutation({
    mutationFn: () =>
      strategyLabApi.createBacktest(
        {
          strategyId,
          strategyRevision: revision,
          executionPlan: executionPlan({
            timeframe,
            capital,
            adjustmentMode,
            override,
          }),
          dataSnapshotHash: `pit-${from}-${to}-${adjustmentMode}`,
          rangeFrom: `${from}T00:00:00.000Z`,
          rangeTo: `${to}T23:59:59.000Z`,
          complexityScore: 80,
        },
        key(),
      ),
    onSuccess: (run) => router.push(`/backtests/${run.id}`),
  });
  return (
    <StrategyLabShell>
      <main className="lab-main">
        <LabHeading
          eyebrow="Deterministic runtime"
          title="Bir revision. Bir snapshot. Aynı sonuç."
          copy="Run isteği immutable strategy revision, point-in-time veri snapshot’ı ve versioned policy’lerle sabitlenir."
        />
        <PastPerformanceWarning />
        <section className="run-launchpad" aria-labelledby="run-title">
          <div>
            <p className="rail-label">NEW RUN</p>
            <h2 id="run-title">Backtest başlat</h2>
          </div>
          <div className="form-grid four">
            <label>
              Strategy
              <select
                aria-label="Backtest stratejisi"
                value={strategyId}
                onChange={(event) => {
                  setStrategyId(event.target.value);
                  const item = strategies.data?.find(
                    (strategy) => strategy.id === event.target.value,
                  );
                  if (item) setRevision(item.currentRevision);
                }}
              >
                <option value="">Seçin</option>
                {strategies.data?.map((strategy) => (
                  <option value={strategy.id} key={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Revision
              <select
                aria-label="Strategy revision"
                value={revision}
                onChange={(event) => setRevision(Number(event.target.value))}
              >
                {(revisions.data ?? [{ revision }]).map((item) => (
                  <option key={item.revision} value={item.revision}>
                    Revision {item.revision}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Başlangıç
              <input
                aria-label="Backtest başlangıç"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              Bitiş
              <input
                aria-label="Backtest bitiş"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <label>
              Başlangıç sermayesi
              <input
                aria-label="Başlangıç sermayesi"
                inputMode="decimal"
                value={capital}
                onChange={(event) => setCapital(event.target.value)}
              />
            </label>
            <label>
              Timeframe
              <select
                aria-label="Backtest timeframe"
                value={timeframe}
                onChange={(event) => setTimeframe(event.target.value)}
              >
                <option>1d</option>
                <option>1h</option>
                <option>1w</option>
              </select>
            </label>
            <label>
              Adjustment
              <select
                aria-label="Adjustment mode"
                value={adjustmentMode}
                onChange={(event) => setAdjustmentMode(event.target.value)}
              >
                <option value="raw">Raw</option>
                <option value="splitAdjusted">Split adjusted</option>
                <option value="totalReturnAdjusted">Total return</option>
              </select>
            </label>
            <label>
              entryThreshold override
              <input
                aria-label="Parametre override"
                type="number"
                value={override}
                onChange={(event) => setOverride(event.target.value)}
              />
            </label>
          </div>
          <div className="execution-summary">
            <span>Closed bar → next open</span>
            <span>Komisyon %0,10</span>
            <span>Slippage 5 bps</span>
            <span>XU100 benchmark</span>
          </div>
          {create.isError && <p role="alert">{safeLabError(create.error)}</p>}
          <button
            className="button primary"
            type="button"
            disabled={!strategyId || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Gönderiliyor…' : 'Backtest çalıştır'}
          </button>
        </section>
        <section className="run-register">
          <div className="section-heading-row">
            <div>
              <p className="rail-label">RUN REGISTER</p>
              <h2>Son çalışmalar</h2>
            </div>
          </div>
          {runs.isLoading && (
            <WorkspaceState kind="loading">
              Run kayıtları yükleniyor…
            </WorkspaceState>
          )}
          {runs.data?.map((run) => (
            <Link
              className="run-row"
              href={`/backtests/${run.id}`}
              key={run.id}
            >
              <span className={clsx('run-status', run.status)}>
                {run.status}
              </span>
              <strong>Revision {run.strategyRevision}</strong>
              <span>{run.progressPercent}%</span>
              <time>{new Date(run.queuedAt).toLocaleDateString('tr-TR')}</time>
            </Link>
          ))}
        </section>
      </main>
    </StrategyLabShell>
  );
}

export function BacktestDetailWorkspace({ id }: { readonly id: string }) {
  const queryClient = useQueryClient();
  const run = useQuery({
    queryKey: ['backtest', id],
    queryFn: () => strategyLabApi.backtest(id),
    retry: false,
    refetchInterval: (query) => {
      const current = query.state.data;
      return current && !terminal.has(current.status) ? 1000 : false;
    },
  });
  const completed = run.data?.status === 'completed';
  const summary = useQuery({
    queryKey: ['backtest', id, 'summary'],
    queryFn: () => strategyLabApi.summary(id),
    enabled: completed,
  });
  const methodology = useQuery({
    queryKey: ['backtest', id, 'methodology'],
    queryFn: () => strategyLabApi.methodology(id),
    enabled: completed,
  });
  const orders = useQuery({
    queryKey: ['backtest', id, 'orders'],
    queryFn: () => strategyLabApi.orders(id),
    enabled: completed,
  });
  const fills = useQuery({
    queryKey: ['backtest', id, 'fills'],
    queryFn: () => strategyLabApi.fills(id),
    enabled: completed,
  });
  const series = useQuery({
    queryKey: ['backtest', id, 'series'],
    queryFn: async () => ({
      equity: await strategyLabApi.series(id, 'equity'),
      benchmark: await strategyLabApi.series(id, 'benchmark'),
      drawdown: await strategyLabApi.series(id, 'drawdown'),
      cash: await strategyLabApi.series(id, 'cash'),
      exposure: await strategyLabApi.series(id, 'exposure'),
    }),
    enabled: completed,
  });
  const trades = useInfiniteQuery({
    queryKey: ['backtest', id, 'trades'],
    queryFn: ({ pageParam }) => strategyLabApi.trades(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: completed,
  });
  const cancel = useMutation({
    mutationFn: () => strategyLabApi.cancelBacktest(id),
    onSuccess: (value) => queryClient.setQueryData(['backtest', id], value),
  });
  const [selectedTrade, setSelectedTrade] = useState<Record<
    string,
    unknown
  > | null>(null);
  if (run.isError)
    return (
      <StrategyLabShell>
        <main className="lab-main">
          <WorkspaceState kind="error">
            {safeLabError(run.error)}
          </WorkspaceState>
        </main>
      </StrategyLabShell>
    );
  const value = run.data;
  return (
    <StrategyLabShell>
      <main className="lab-main">
        <LabHeading
          eyebrow={`Run ${id.slice(0, 8)}`}
          title={
            value?.status === 'completed'
              ? 'Araştırma kaydı tamamlandı.'
              : 'Simülasyon ilerliyor.'
          }
          copy={`Strategy revision ${value?.strategyRevision ?? '—'} · snapshot ${value?.dataSnapshotHash ?? 'çözülüyor'}`}
          action={
            value && !terminal.has(value.status) ? (
              <button
                type="button"
                className="button danger"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Çalışmayı iptal et
              </button>
            ) : undefined
          }
        />
        <PastPerformanceWarning />
        {value && !terminal.has(value.status) && <ProgressPanel run={value} />}
        {value && ['failed', 'cancelled', 'expired'].includes(value.status) && (
          <WorkspaceState kind="error">
            Run {value.status}.{' '}
            {value.errorCode ?? 'Kalıcı sonuç oluşturulmadı.'}
          </WorkspaceState>
        )}
        {completed && (
          <>
            <EvidenceTrace
              run={value!}
              summary={summary.data}
              methodology={methodology.data}
            />
            <MetricBoard summary={summary.data} />
            {summary.data?.warnings?.map((warning) => (
              <Warning key={warning.code} code={warning.code}>
                {warning.message ??
                  'Point-in-time veya veri kalite kapsamı eksik; bu bulgu sonuç yorumunda korunmalıdır.'}
              </Warning>
            ))}
            {series.data && <ResultCharts data={series.data} />}
            <section className="result-section">
              <div className="section-heading-row">
                <div>
                  <p className="rail-label">TRADES</p>
                  <h2>İşlem günlüğü</h2>
                </div>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => downloadSummary(id, summary.data)}
                >
                  Özet CSV
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sembol</th>
                      <th>Açılış</th>
                      <th>Kapanış</th>
                      <th>Miktar</th>
                      <th>P&amp;L</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {trades.data?.pages
                      .flatMap((page) => page.items)
                      .map((trade) => (
                        <tr key={trade.id}>
                          <th scope="row">
                            {trade.symbol ?? trade.instrumentId ?? '—'}
                          </th>
                          <td>{trade.openedAt}</td>
                          <td>{trade.closedAt}</td>
                          <td>{trade.quantity}</td>
                          <td>
                            <SignedValue value={trade.realizedPnl} />
                          </td>
                          <td>
                            <button
                              className="text-action"
                              type="button"
                              onClick={() =>
                                setSelectedTrade(
                                  trade as unknown as Record<string, unknown>,
                                )
                              }
                            >
                              Detay
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {trades.hasNextPage && (
                <button
                  type="button"
                  className="button ghost"
                  disabled={trades.isFetchingNextPage}
                  onClick={() => void trades.fetchNextPage()}
                >
                  Daha fazla işlem
                </button>
              )}
              {selectedTrade && (
                <aside className="trade-detail" aria-label="İşlem detayı">
                  <button
                    aria-label="İşlem detayını kapat"
                    type="button"
                    onClick={() => setSelectedTrade(null)}
                  >
                    ×
                  </button>
                  <h3>İşlem detayı</h3>
                  <pre>{JSON.stringify(selectedTrade, null, 2)}</pre>
                </aside>
              )}
            </section>
            <section className="result-split">
              <DataList title="Orders" items={orders.data ?? []} />
              <DataList title="Fills" items={fills.data ?? []} />
            </section>
            <section
              className="methodology-panel"
              aria-labelledby="methodology-title"
            >
              <p className="rail-label">REPRODUCIBILITY</p>
              <h2 id="methodology-title">Metodoloji ve veri snapshot’ı</h2>
              <pre>{JSON.stringify(methodology.data ?? {}, null, 2)}</pre>
              <p>
                Eksik point-in-time veri, missing bar ve coverage uyarıları
                sonuçtan gizlenmez.
              </p>
            </section>
          </>
        )}
      </main>
    </StrategyLabShell>
  );
}

export function ExperimentsWorkspace() {
  const router = useRouter();
  const strategies = useQuery({
    queryKey: ['strategies'],
    queryFn: () => strategyLabApi.strategies(),
  });
  const experiments = useQuery({
    queryKey: ['experiments'],
    queryFn: strategyLabApi.experiments,
  });
  const [strategyId, setStrategyId] = useState('');
  const [values, setValues] = useState('25, 35, 45');
  const [inSampleEnd, setInSampleEnd] = useState('2023-12-31');
  const [outSampleEnd, setOutSampleEnd] = useState('2025-12-31');
  useEffect(() => {
    if (!strategyId && strategies.data?.[0])
      setStrategyId(strategies.data[0].id);
  }, [strategies.data, strategyId]);
  const combinations = values
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const selected = strategies.data?.find(
    (strategy) => strategy.id === strategyId,
  );
  const create = useMutation({
    mutationFn: () =>
      strategyLabApi.createExperiment({
        name: `Threshold grid · ${new Date().toLocaleDateString('tr-TR')}`,
        strategyId,
        strategyRevision: selected?.currentRevision ?? 1,
        dataSnapshotId: '00000000-0000-4000-8000-000000006841',
        dataSnapshotHash: `experiment-${inSampleEnd}-${outSampleEnd}`,
        definition: {
          parameterDefinitions: [
            {
              name: 'entryThreshold',
              type: 'number',
              defaultValue: 35,
              minimum: 0,
              maximum: 100,
            },
          ],
          grid: {
            axes: [
              { parameter: 'entryThreshold', values: combinations.map(Number) },
            ],
            samples: [
              { role: 'inSample', from: '2021-01-01', to: inSampleEnd },
              { role: 'outOfSample', from: inSampleEnd, to: outSampleEnd },
            ],
            maximumCombinations: 100,
          },
        },
      }),
    onSuccess: (value) => router.push(`/experiments/${value.id}`),
  });
  return (
    <StrategyLabShell>
      <main className="lab-main">
        <LabHeading
          eyebrow="Bounded grid research"
          title="En iyi sonucu değil, sağlam sonucu ara."
          copy="Parametre hassasiyetini in-sample ve out-of-sample sonuçları yan yana tutarak inceleyin."
        />
        <PastPerformanceWarning />
        <section className="experiment-composer">
          <div className="form-grid four">
            <label>
              Strategy
              <select
                aria-label="Experiment stratejisi"
                value={strategyId}
                onChange={(event) => setStrategyId(event.target.value)}
              >
                <option value="">Seçin</option>
                {strategies.data?.map((strategy) => (
                  <option key={strategy.id} value={strategy.id}>
                    {strategy.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              entryThreshold değerleri
              <input
                aria-label="Grid değerleri"
                value={values}
                onChange={(event) => setValues(event.target.value)}
              />
            </label>
            <label>
              In-sample bitiş
              <input
                aria-label="In-sample bitiş"
                type="date"
                value={inSampleEnd}
                onChange={(event) => setInSampleEnd(event.target.value)}
              />
            </label>
            <label>
              Out-of-sample bitiş
              <input
                aria-label="Out-of-sample bitiş"
                type="date"
                value={outSampleEnd}
                onChange={(event) => setOutSampleEnd(event.target.value)}
              />
            </label>
          </div>
          <div className="combination-readout">
            <strong>{combinations.length * 2}</strong>
            <span>run · {combinations.length} binding × 2 sample</span>
            <span>Karmaşıklık: bounded</span>
          </div>
          <Warning code="OVERFITTING">
            Çok sayıda kombinasyon, seçim yanlılığı ve out-of-sample bozulma
            riskini artırır.
          </Warning>
          <button
            className="button primary"
            type="button"
            disabled={
              !strategyId || combinations.length < 2 || create.isPending
            }
            onClick={() => create.mutate()}
          >
            Deneyi başlat
          </button>
        </section>
        <section className="run-register">
          <div className="section-heading-row">
            <div>
              <p className="rail-label">EXPERIMENT REGISTER</p>
              <h2>Deneyler</h2>
            </div>
          </div>
          {experiments.data?.map((item) => (
            <Link
              className="run-row"
              href={`/experiments/${item.id}`}
              key={item.id}
            >
              <span className={clsx('run-status', item.status)}>
                {item.status}
              </span>
              <strong>{item.name}</strong>
              <span>
                {item.completedRunCount}/{item.combinationCount}
              </span>
              <time>
                {new Date(item.createdAt).toLocaleDateString('tr-TR')}
              </time>
            </Link>
          ))}
        </section>
      </main>
    </StrategyLabShell>
  );
}

export function ExperimentDetailWorkspace({ id }: { readonly id: string }) {
  const experiment = useQuery({
    queryKey: ['experiment', id],
    queryFn: () => strategyLabApi.experiment(id),
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.status;
      return state &&
        !['completed', 'partial', 'failed', 'cancelled'].includes(state)
        ? 1500
        : false;
    },
  });
  const results = useQuery({
    queryKey: ['experiment', id, 'results'],
    queryFn: () => strategyLabApi.experimentResults(id),
    enabled: Boolean(experiment.data),
  });
  const matrix = useQuery({
    queryKey: ['experiment', id, 'matrix'],
    queryFn: () => strategyLabApi.experimentMatrix(id),
    enabled: Boolean(experiment.data),
  });
  const cancel = useMutation({
    mutationFn: () => strategyLabApi.cancelExperiment(id),
  });
  const [sortMetric, setSortMetric] = useState('totalReturn');
  if (experiment.isError)
    return (
      <StrategyLabShell>
        <main className="lab-main">
          <WorkspaceState kind="error">
            {safeLabError(experiment.error)}
          </WorkspaceState>
        </main>
      </StrategyLabShell>
    );
  const sorted = [...(matrix.data ?? [])].sort(
    (a, b) =>
      Number(
        (b.selectedMetrics as Record<string, unknown> | null)?.[sortMetric] ??
          -Infinity,
      ) -
      Number(
        (a.selectedMetrics as Record<string, unknown> | null)?.[sortMetric] ??
          -Infinity,
      ),
  );
  return (
    <StrategyLabShell>
      <main className="lab-main">
        <LabHeading
          eyebrow={`Experiment ${id.slice(0, 8)}`}
          title={experiment.data?.name ?? 'Deney yükleniyor.'}
          copy={`${experiment.data?.completedRunCount ?? 0} tamamlandı · ${experiment.data?.failedRunCount ?? 0} başarısız · ${experiment.data?.combinationCount ?? 0} toplam`}
          action={
            experiment.data &&
            !['completed', 'partial', 'failed', 'cancelled'].includes(
              experiment.data.status,
            ) ? (
              <button
                className="button danger"
                type="button"
                onClick={() => cancel.mutate()}
              >
                Deneyi iptal et
              </button>
            ) : undefined
          }
        />
        <PastPerformanceWarning />
        <div className="experiment-progress" role="status">
          <span
            style={{
              width: `${experiment.data ? (experiment.data.completedRunCount / Math.max(1, experiment.data.combinationCount)) * 100 : 0}%`,
            }}
          />
          <p>
            {experiment.data?.status ?? 'queued'} · in/out-of-sample ayrımı
            korunuyor
          </p>
        </div>
        <section className="comparison-section">
          <div className="section-heading-row">
            <div>
              <p className="rail-label">COMPARISON MATRIX</p>
              <h2>Parametre dayanıklılığı</h2>
            </div>
            <div className="row-actions">
              <label>
                Sırala
                <select
                  aria-label="Matrix metriği"
                  value={sortMetric}
                  onChange={(event) => setSortMetric(event.target.value)}
                >
                  <option value="totalReturn">Return</option>
                  <option value="maximumDrawdown">Drawdown</option>
                  <option value="sharpe">Sharpe</option>
                </select>
              </label>
              <button
                className="button ghost"
                type="button"
                onClick={() => void exportExperiment(id)}
              >
                CSV export
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Binding</th>
                  <th>Sample</th>
                  <th>Return</th>
                  <th>Drawdown</th>
                  <th>Sharpe</th>
                  <th>Rank</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, index) => {
                  const metrics = (row.selectedMetrics ?? {}) as Record<
                    string,
                    unknown
                  >;
                  return (
                    <tr key={safeText(row.bindingHash, String(index))}>
                      <th scope="row">
                        {JSON.stringify(row.parameterBinding ?? {})}
                      </th>
                      <td>{safeText(row.sampleRole)}</td>
                      <td>{metric(metrics.totalReturn)}</td>
                      <td>{metric(metrics.maximumDrawdown)}</td>
                      <td>{metric(metrics.sharpe)}</td>
                      <td>{safeText(row.rank)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Warning code="OVERFITTING">
            En iyi in-sample sonucu tek başına seçim kriteri değildir.
            Out-of-sample bozulma, turnover ve parameter instability birlikte
            değerlendirilir.
          </Warning>
          <p className="inline-note">
            {results.data?.length ?? 0} child run kaydı · Holdout verisi
            strategy girişine sızdırılmaz.
          </p>
        </section>
      </main>
    </StrategyLabShell>
  );
}

function condition(
  indicator: 'RSI' | 'EMA',
  operator: StrategyConditionDraft['operator'],
  value: number,
): StrategyConditionDraft {
  return { indicator, period: indicator === 'RSI' ? 14 : 20, operator, value };
}
function editorDraft(definition: StrategyDefinition) {
  const parseRule = (value: Record<string, unknown>) => {
    const root = value.root as { children?: Record<string, unknown>[] };
    return (root.children ?? []).map((node) => {
      const left = node.left as {
        code?: string;
        parameters?: { period?: number };
      };
      const right = node.right as {
        type?: string;
        value?: number;
        parameters?: { period?: number };
      };
      const operator = node.operator as StrategyConditionDraft['operator'];
      return {
        indicator: left.code === 'EMA' ? 'EMA' : 'RSI',
        period: left.parameters?.period ?? 14,
        operator,
        value: operator.startsWith('CROSSES')
          ? (right.parameters?.period ?? 50)
          : (right.value ?? 35),
      } satisfies StrategyConditionDraft;
    });
  };
  const sizing = definition.positionSizing as {
    type?: string;
    amount?: number;
    percent?: number;
  };
  const risk = definition.riskControls as {
    stopLossPercent?: number;
    takeProfitPercent?: number;
    maxConcurrentPositions?: number;
  };
  const execution = definition.executionPolicy as { code?: string };
  const cost = definition.costPolicy as {
    code?: string;
    commissionPercent?: number;
    slippageBps?: number;
  };
  const universe = definition.entryRule.universe as {
    indexCodes?: string[];
  };
  const parameter = definition.parameters[0] as { name?: string } | undefined;
  return {
    indexCodes: (universe.indexCodes ?? []).join(', '),
    entry: parseRule(definition.entryRule),
    exit: parseRule(definition.exitRule),
    sizing:
      sizing.type === 'fixedCash' || sizing.type === 'fixedPercent'
        ? sizing.type
        : ('equalWeight' as const),
    sizeValue: sizing.amount ?? sizing.percent ?? 10_000,
    stopLoss: risk.stopLossPercent ?? 5,
    takeProfit: risk.takeProfitPercent ?? 15,
    maxPositions: risk.maxConcurrentPositions ?? 5,
    execution:
      execution.code === 'same_bar_close_research'
        ? ('same_bar_close_research' as const)
        : ('closed_bar_next_open' as const),
    costFree: cost.code === 'cost_free',
    commission: cost.commissionPercent ?? 0.1,
    slippage: cost.slippageBps ?? 5,
    parameterName: parameter?.name ?? 'entryThreshold',
  };
}
function rule(conditions: StrategyConditionDraft[], indexCodes: string) {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: indexCodes
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'root-and',
      operator: 'AND',
      children: conditions.map((item, index) => ({
        type: 'condition',
        nodeId: `condition-${index + 1}`,
        operator: item.operator,
        left: {
          type: 'indicator',
          code: item.indicator,
          version: 1,
          timeframe: '1d',
          parameters: { period: item.period },
        },
        right: item.operator.startsWith('CROSSES')
          ? {
              type: 'indicator',
              code: 'EMA',
              version: 1,
              timeframe: '1d',
              parameters: { period: item.value },
            }
          : { type: 'constantNumber', value: item.value },
      })),
    },
  };
}
function buildDefinition(input: {
  indexCodes: string;
  entry: StrategyConditionDraft[];
  exit: StrategyConditionDraft[];
  sizing: 'equalWeight' | 'fixedCash' | 'fixedPercent';
  sizeValue: number;
  stopLoss: number;
  takeProfit: number;
  maxPositions: number;
  execution: 'closed_bar_next_open' | 'same_bar_close_research';
  costFree: boolean;
  commission: number;
  slippage: number;
  benchmark: string;
  parameterName: string;
}): StrategyDefinition {
  return {
    schemaVersion: 1,
    baseTimeframe: '1d',
    entryRule: rule(input.entry, input.indexCodes),
    exitRule: rule(input.exit, input.indexCodes),
    filterRule: null,
    parameters: [
      {
        name: input.parameterName || 'entryThreshold',
        type: 'number',
        defaultValue: 35,
        minimum: 0,
        maximum: 100,
      },
    ],
    positionSizing:
      input.sizing === 'equalWeight'
        ? { type: 'equalWeight' }
        : input.sizing === 'fixedCash'
          ? { type: 'fixedCash', amount: input.sizeValue }
          : { type: 'fixedPercent', percent: input.sizeValue },
    riskControls: {
      stopLossPercent: input.stopLoss,
      takeProfitPercent: input.takeProfit,
      maxPositionWeight: 20,
      maxConcurrentPositions: input.maxPositions,
      allowShort: false,
      allowLeverage: false,
      allowNegativeCash: false,
    },
    executionPolicy: {
      code: input.execution,
      version:
        input.execution === 'closed_bar_next_open'
          ? 'next-open-v1'
          : 'same-bar-research-v1',
      signalBarPolicy: 'closed_only',
      higherTimeframeBarPolicy: 'closed_only',
      missingBarPolicy: 'defer_to_next_available',
    },
    costPolicy: input.costFree
      ? { code: 'cost_free', version: 'cost-free-v1', explicitlyAccepted: true }
      : {
          code: 'percentage_commission_fixed_bps_slippage',
          version: 'cost-v1',
          commissionPercent: input.commission,
          minimumCommission: 1,
          slippageBps: input.slippage,
          fixedFee: 0,
          marketTaxPercent: 0,
        },
    dataIntegrityPolicy: {
      universePolicy: 'point_in_time',
      fundamentalAvailabilityPolicy: 'publication_and_revision',
      corporateActionPolicyVersion: 'corporate-action-v1',
      adjustmentMode: 'split_adjusted',
    },
    benchmarkCode: input.benchmark || null,
  };
}
function executionPlan(input: {
  timeframe: string;
  capital: string;
  adjustmentMode: string;
  override: string;
}) {
  return {
    runId: 'assigned-by-runtime',
    strategyRevisionId: 'selected-revision',
    dataSnapshotHash: 'resolved-by-runtime',
    engineVersion: 'backtest-engine-v1',
    executionPolicyVersion: 'next-open-v1',
    eventOrderingPolicyVersion: 'deterministic-ordering-v1',
    roundingPolicyVersion: 'whole-share-v1',
    timeframe: input.timeframe,
    initialCash: input.capital,
    entryRule: {},
    exitRule: {},
    positionSizing: { type: 'equalWeight' },
    maxConcurrentPositions: 5,
    fractionalShares: false,
    allowShort: false,
    allowLeverage: false,
    liquidateAtEnd: true,
    parameterBindings: { entryThreshold: Number(input.override) },
    corporateActionPolicy: { adjustmentMode: input.adjustmentMode },
    costPolicy: {
      version: 'cost-v1',
      commissionPercent: '0.1',
      slippageBps: '5',
    },
  };
}
function LabHeading(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly copy: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <header className="lab-heading">
      <div>
        <p className="rail-label">{props.eyebrow}</p>
        <h1>{props.title}</h1>
        <p>{props.copy}</p>
      </div>
      {props.action}
    </header>
  );
}
function EditorSection(props: {
  readonly title: string;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="editor-section">
      <header>
        <h2>{props.title}</h2>
        <span>{props.note}</span>
      </header>
      {props.children}
    </section>
  );
}
function Warning({
  code,
  children,
}: {
  readonly code: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="lab-warning" role="note">
      <strong>{code}</strong>
      <span>{children}</span>
    </div>
  );
}
function PastPerformanceWarning() {
  return (
    <Warning code="ARAŞTIRMA UYARISI">
      Geçmiş performans gelecekteki getiriyi garanti etmez; sonuçlar yatırım
      tavsiyesi değildir.
    </Warning>
  );
}
function ProgressPanel({ run }: { readonly run: BacktestRun }) {
  const active = Math.min(
    runStages.length - 1,
    Math.floor((run.progressPercent / 100) * runStages.length),
  );
  return (
    <section className="progress-panel" aria-live="polite">
      <div className="progress-readout">
        <strong>{run.progressPercent}%</strong>
        <span>{run.status}</span>
      </div>
      <div className="progress-track">
        <span style={{ width: `${run.progressPercent}%` }} />
      </div>
      <ol>
        {runStages.map((stage, index) => (
          <li
            className={clsx(
              index < active && 'done',
              index === active && 'active',
            )}
            key={stage}
          >
            {stage}
          </li>
        ))}
      </ol>
    </section>
  );
}
function EvidenceTrace({
  run,
  summary,
  methodology,
}: {
  readonly run: BacktestRun;
  readonly summary?: BacktestSummary | undefined;
  readonly methodology?: Record<string, unknown> | undefined;
}) {
  return (
    <div
      className="evidence-line result-evidence"
      aria-label="Sonuç kanıt hattı"
    >
      <span>REV {run.strategyRevision}</span>
      <span>{summary?.dataSnapshot?.hash ?? run.dataSnapshotHash}</span>
      <span>{safeText(methodology?.engineVersion, 'engine-v1')}</span>
      <span className="active">RESULT</span>
    </div>
  );
}
function MetricBoard({
  summary,
}: {
  readonly summary?: BacktestSummary | undefined;
}) {
  const values: [string, unknown][] = [
    [
      'Toplam getiri',
      summaryMetric(summary, 'totalReturn', summary?.totalReturn),
    ],
    [
      'Yıllık getiri',
      summaryMetric(summary, 'annualizedReturn', summary?.annualizedReturn),
    ],
    [
      'Volatilite',
      summaryMetric(
        summary,
        'annualizedVolatility',
        summary?.annualizedVolatility,
      ),
    ],
    [
      'Benchmark',
      summaryMetric(summary, 'benchmarkReturn', summary?.benchmarkReturn),
    ],
    [
      'Fazla getiri',
      summaryMetric(summary, 'excessReturn', summary?.excessReturn),
    ],
    ['Maks. düşüş', summary?.maximumDrawdown],
    ['Sharpe', summaryMetric(summary, 'sharpeRatio', summary?.sharpe)],
    ['Sortino', summaryMetric(summary, 'sortinoRatio', summary?.sortino)],
    ['Calmar', summaryMetric(summary, 'calmarRatio', summary?.calmar)],
    ['Expectancy', summaryMetric(summary, 'expectancy', summary?.expectancy)],
    ['Turnover', summaryMetric(summary, 'turnover', summary?.turnover)],
    ['İşlem', summary?.tradeCount],
    ['Kazanma oranı', summary?.winRate],
    ['Profit factor', summary?.profitFactor],
    ['Toplam maliyet', summary?.totalFees],
  ];
  return (
    <section className="metric-board" aria-label="Backtest özet metrikleri">
      {values.map(([label, value]) => (
        <div key={String(label)}>
          <span>{label}</span>
          <strong>{metric(value)}</strong>
        </div>
      ))}
    </section>
  );
}

function summaryMetric(
  summary: BacktestSummary | undefined,
  name: string,
  fallback: unknown,
) {
  const result = summary?.metrics?.[name];
  return result?.status === 'complete' ? result.value : fallback;
}
function ResultCharts({
  data,
}: {
  readonly data: {
    equity: SeriesPoint[];
    benchmark: SeriesPoint[];
    drawdown: SeriesPoint[];
    cash: SeriesPoint[];
    exposure: SeriesPoint[];
  };
}) {
  return (
    <section className="result-section">
      <div className="section-heading-row">
        <div>
          <p className="rail-label">SERIES</p>
          <h2>Equity, benchmark ve risk izi</h2>
        </div>
      </div>
      <div className="result-chart-grid">
        <SeriesChart
          title="Equity / Benchmark · trade markers"
          primary={data.equity}
          secondary={data.benchmark}
        />
        <SeriesChart title="Drawdown" primary={data.drawdown} />
        <SeriesChart title="Cash" primary={data.cash} />
        <SeriesChart title="Exposure" primary={data.exposure} />
      </div>
    </section>
  );
}
function SeriesChart({
  title,
  primary,
  secondary = [],
}: {
  readonly title: string;
  readonly primary: SeriesPoint[];
  readonly secondary?: SeriesPoint[];
}) {
  const values = primary
    .map((point) => Number(point.value))
    .filter(Number.isFinite);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  return (
    <figure
      className="lab-chart"
      role="img"
      aria-label={`${title} serisi, ${primary.length} gözlem`}
    >
      <figcaption>{title}</figcaption>
      <div className="spark-bars">
        {primary.slice(-40).map((point) => (
          <i
            key={point.timestamp}
            style={{
              height: `${20 + ((Number(point.value) - min) / Math.max(1, max - min)) * 70}%`,
            }}
            title={`${point.timestamp}: ${point.value}`}
          />
        ))}
      </div>
      {secondary.length > 0 && (
        <span className="benchmark-key">
          ● Benchmark · {secondary.length} nokta
        </span>
      )}
      <p className="chart-a11y-summary">
        Metinsel özet: {primary.length} gözlem; başlangıç{' '}
        {metric(primary[0]?.value)}, son {metric(primary.at(-1)?.value)}, en
        düşük {metric(min)}, en yüksek {metric(max)}.
      </p>
    </figure>
  );
}
function SignedValue({ value }: { readonly value: string }) {
  const number = Number(value);
  return (
    <span className={number >= 0 ? 'signed positive' : 'signed negative'}>
      {number >= 0 ? 'Artış +' : 'Azalış '}
      {value}
    </span>
  );
}
function DataList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: Record<string, unknown>[];
}) {
  return (
    <section>
      <p className="rail-label">{title}</p>
      <h2>{items.length} kayıt</h2>
      <pre>{JSON.stringify(items.slice(0, 8), null, 2)}</pre>
    </section>
  );
}
function metric(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    return 'notEvaluable';
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : 'notEvaluable';
}
function downloadSummary(id: string, summary?: BacktestSummary) {
  const rows = Object.entries(summary ?? {}).filter(([, value]) =>
    ['string', 'number'].includes(typeof value),
  );
  downloadBlob(
    new Blob(
      [
        `metric,value\n${rows.map(([name, value]) => `${name},${String(value).replace(/^([=+\-@])/u, "'$1")}`).join('\n')}`,
      ],
      { type: 'text/csv' },
    ),
    `backtest-${id}.csv`,
  );
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
async function exportExperiment(id: string) {
  downloadBlob(
    await strategyLabApi.exportExperiment(id),
    `experiment-${id}.csv`,
  );
}
function safeText(value: unknown, fallback = '—') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}
