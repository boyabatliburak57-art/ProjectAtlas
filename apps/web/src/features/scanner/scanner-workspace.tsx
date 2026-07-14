'use client';

import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { scannerApi } from './api';
import {
  addChild,
  complexityLabel,
  condition,
  emptyRule,
  localValidate,
  moveNode,
  nodeId,
  removeNode,
  updateNode,
} from './rule-model';
import type {
  ConditionNode,
  GroupNode,
  IndicatorDefinition,
  IndicatorOperand,
  OperatorDefinition,
  PresetSummary,
  RuleNode,
  ScanResult,
  ScanRule,
  ScanRun,
  Timeframe,
  ValidationResult,
} from './types';

const timeframes: Timeframe[] = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
  '1w',
];
const terminalStatuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);
const operatorLabels: Record<string, string> = {
  EQ: '=',
  NE: '≠',
  GT: '>',
  GTE: '≥',
  LT: '<',
  LTE: '≤',
  BETWEEN: 'arasında',
  OUTSIDE: 'dışında',
  CROSSES_ABOVE: 'yukarı keser',
  CROSSES_BELOW: 'aşağı keser',
  HIGHEST_IN_PERIOD: 'dönemin en yükseği',
  LOWEST_IN_PERIOD: 'dönemin en düşüğü',
  INCREASED_BY_PERCENT: '% arttı',
  DECREASED_BY_PERCENT: '% azaldı',
  WITHIN_PERCENT_OF: '% yakınında',
  IS_TRUE: 'doğru',
  IS_FALSE: 'yanlış',
};

function key(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function ScannerWorkspace() {
  const indicatorsQuery = useQuery({
    queryKey: ['scanner', 'indicators'],
    queryFn: scannerApi.indicators,
  });
  const operatorsQuery = useQuery({
    queryKey: ['scanner', 'operators'],
    queryFn: scannerApi.operators,
  });
  const presetsQuery = useQuery({
    queryKey: ['scanner', 'presets'],
    queryFn: scannerApi.presets,
  });
  const [rule, setRule] = useState<ScanRule | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<PresetSummary | null>(
    null,
  );
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [run, setRun] = useState<ScanRun | null>(null);
  const [stableProgress, setStableProgress] = useState<
    ScanRun['progress'] | null
  >(null);
  const [selectedResult, setSelectedResult] = useState<ScanResult | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [includeSymbols, setIncludeSymbols] = useState('');
  const [excludeSymbols, setExcludeSymbols] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>(
    'comfortable',
  );
  const [sort, setSort] = useState<'rank' | 'symbol'>('rank');
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const saveDialog = useRef<HTMLDialogElement>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!rule && indicatorsQuery.data?.[0])
      setRule(emptyRule(indicatorsQuery.data[0]));
  }, [indicatorsQuery.data, rule]);

  const localErrors = useMemo(() => (rule ? localValidate(rule) : []), [rule]);
  const catalogReady = Boolean(
    indicatorsQuery.data?.length && operatorsQuery.data?.length,
  );
  const active = run && !terminalStatuses.has(run.status);

  const statusQuery = useQuery({
    queryKey: ['scanner', 'run', run?.id],
    queryFn: () => scannerApi.status(run!.id),
    enabled: Boolean(active),
    refetchInterval: (query) => {
      const current = query.state.data;
      if (
        !current ||
        terminalStatuses.has(current.status) ||
        current.progress.terminal
      )
        return false;
      return Math.max(750, current.progress.pollAfterMs ?? 1_500);
    },
  });

  useEffect(() => {
    if (!statusQuery.data) return;
    setRun(statusQuery.data);
    setStableProgress((previous) =>
      mergeProgress(previous, statusQuery.data.progress),
    );
  }, [statusQuery.data]);

  const resultsQuery = useInfiniteQuery({
    queryKey: ['scanner', 'results', run?.id],
    queryFn: ({ pageParam }) => scannerApi.results(run!.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: run?.status === 'completed',
  });

  const validateMutation = useMutation({
    mutationFn: () => scannerApi.validate(rule!),
    onSuccess: setValidation,
  });
  const runMutation = useMutation({
    mutationFn: async () => {
      const server = await scannerApi.validate(rule!);
      setValidation(server);
      if (!server.valid) throw new Error('SCAN_RULE_INVALID');
      return selectedPreset
        ? scannerApi.runPreset(selectedPreset.code, key())
        : scannerApi.run(rule!, key());
    },
    onSuccess: (created) => {
      setRun(created);
      setStableProgress(created.progress);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => scannerApi.cancel(run!.id),
    onSuccess: setRun,
  });

  function changeRule(updater: (current: ScanRule) => ScanRule) {
    setRule((current) => (current ? updater(current) : current));
    setSelectedPreset(null);
    setValidation(null);
    setRun(null);
    setStableProgress(null);
  }

  async function loadPreset(preset: PresetSummary) {
    const detail = preset.rule ? preset : await scannerApi.preset(preset.code);
    if (!detail.rule) return;
    setRule(detail.rule);
    setSelectedPreset(detail);
    setValidation(null);
    setRun(null);
    setShowPresets(false);
  }

  if (indicatorsQuery.isLoading || operatorsQuery.isLoading) {
    return (
      <main className="scanner-loading">
        <span className="status-dot" /> Tarayıcı kataloğu yükleniyor…
      </main>
    );
  }
  if (!catalogReady || !rule) {
    return (
      <main className="scanner-loading error-state">
        <strong>Katalog yüklenemedi.</strong>
        <span>API bağlantısını kontrol edip sayfayı yenileyin.</span>
      </main>
    );
  }

  const progress = stableProgress ?? run?.progress;
  const results = sortResults(
    resultsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    sort,
  );
  const filteredIndicators = indicatorsQuery.data!.filter((item) =>
    `${item.code} ${item.name} ${item.category}`
      .toLocaleLowerCase('tr')
      .includes(catalogSearch.toLocaleLowerCase('tr')),
  );

  return (
    <main className="scanner-shell">
      <header className="scanner-topbar">
        <div>
          <a className="scanner-brand" href="/">
            ATLAS / SCANNER
          </a>
          <p>
            {selectedPreset
              ? `Hazır tarama · ${selectedPreset.name} · r${selectedPreset.revision}`
              : 'Özel tarama · kaydedilmedi'}
          </p>
        </div>
        <div className="top-actions">
          <button
            className="button ghost"
            type="button"
            onClick={() => setShowPresets((value) => !value)}
            aria-expanded={showPresets}
          >
            Hazır taramalar
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => saveDialog.current?.showModal()}
          >
            Taramayı kaydet
          </button>
          <button
            className="button primary"
            type="button"
            disabled={localErrors.length > 0 || runMutation.isPending}
            onClick={() => runMutation.mutate()}
          >
            {runMutation.isPending ? 'Başlatılıyor…' : 'Taramayı çalıştır'}
          </button>
        </div>
      </header>

      {showPresets && (
        <PresetStrip presets={presetsQuery.data ?? []} onSelect={loadPreset} />
      )}

      <div className="scanner-grid">
        <div className="build-column">
          <UniversePanel
            rule={rule}
            includeSymbols={includeSymbols}
            excludeSymbols={excludeSymbols}
            onInclude={setIncludeSymbols}
            onExclude={setExcludeSymbols}
            onChange={changeRule}
          />
          <section
            className="workspace-section builder-section"
            aria-labelledby="builder-title"
          >
            <SectionHeading
              index="02"
              title="Kural oluşturucu"
              note={`${countNodes(rule.root)} düğüm`}
            />
            <GroupEditor
              group={rule.root}
              indicators={indicatorsQuery.data!}
              operators={operatorsQuery.data!}
              errors={[...localErrors, ...(validation?.errors ?? [])]}
              root
              onUpdate={(id, updater) =>
                changeRule((current) => ({
                  ...current,
                  root: updateNode(current.root, id, updater),
                }))
              }
              onAdd={(id, child) =>
                changeRule((current) => ({
                  ...current,
                  root: addChild(current.root, id, child),
                }))
              }
              onRemove={(id) =>
                changeRule((current) => ({
                  ...current,
                  root: removeNode(current.root, id),
                }))
              }
              onMove={(id, direction) =>
                changeRule((current) => ({
                  ...current,
                  root: moveNode(current.root, id, direction),
                }))
              }
            />
          </section>
        </div>

        <aside className="catalog-column" aria-label="Kataloglar">
          <section className="workspace-section catalog-section">
            <SectionHeading
              index="03"
              title="İndikatör kataloğu"
              note={`${indicatorsQuery.data!.length} tanım`}
            />
            <label className="search-field">
              <span className="sr-only">İndikatör ara</span>
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                placeholder="Kod veya ad ara"
              />
            </label>
            <div className="catalog-list">
              {filteredIndicators.map((item) => (
                <div
                  className="catalog-item"
                  key={`${item.code}-${item.version}`}
                >
                  <span className="catalog-code">{item.code}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.category} · v{item.version}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="workspace-section operator-section">
            <SectionHeading index="04" title="Operatör kataloğu" note="API" />
            <div className="operator-cloud">
              {operatorsQuery.data!.map((operator) => (
                <span key={operator.code}>
                  {operatorLabels[operator.code] ?? operator.code}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="validation-bar" aria-labelledby="validation-title">
        <div>
          <p className="section-kicker">05 / Sunucu doğrulaması</p>
          <h2 id="validation-title">
            {validation?.valid
              ? 'Kural çalışmaya hazır.'
              : localErrors.length
                ? `${localErrors.length} yerel hata var.`
                : 'Sunucu planını kontrol edin.'}
          </h2>
          <p>
            {validation?.valid
              ? `${validation.timeframes?.join(', ')} · ${validation.executionMode === 'async' ? 'Asenkron' : 'Senkron'} yürütme · ${validation.complexity?.uniqueIndicatorCount ?? 0} indikatör`
              : (validation?.errors[0]?.message ??
                'AST ve yürütme maliyeti sunucuda doğrulanır.')}
          </p>
        </div>
        <div className="validation-actions">
          {validation?.complexity && (
            <span
              className={clsx(
                'complexity-pill',
                complexityLabel(validation.complexity.score).toLowerCase(),
              )}
            >
              Karmaşıklık: {complexityLabel(validation.complexity.score)}
            </span>
          )}
          <button
            className="button outline"
            type="button"
            disabled={localErrors.length > 0 || validateMutation.isPending}
            onClick={() => validateMutation.mutate()}
          >
            {validateMutation.isPending ? 'Doğrulanıyor…' : 'Sunucuda doğrula'}
          </button>
        </div>
      </section>

      {(run || runMutation.error) && (
        <RunPanel
          run={run}
          progress={progress}
          submitError={runMutation.error}
          onCancel={() => cancelMutation.mutate()}
          cancelling={cancelMutation.isPending}
        />
      )}
      <ResultsSection
        run={run}
        results={results}
        loading={resultsQuery.isLoading}
        error={resultsQuery.error}
        density={density}
        sort={sort}
        watched={watched}
        hasMore={resultsQuery.hasNextPage}
        loadingMore={resultsQuery.isFetchingNextPage}
        onMore={() => void resultsQuery.fetchNextPage()}
        onDensity={setDensity}
        onSort={setSort}
        onWatch={(id) => setWatched((current) => toggleSet(current, id))}
        onExplain={(result) => {
          setSelectedResult(result);
          detailDialog.current?.showModal();
        }}
      />
      <ExplanationDialog dialog={detailDialog} result={selectedResult} />
      <SaveDialog dialog={saveDialog} rule={rule} />
    </main>
  );
}

function SectionHeading({
  index,
  title,
  note,
}: {
  index: string;
  title: string;
  note: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="section-kicker">{index}</p>
        <h2>{title}</h2>
      </div>
      <span>{note}</span>
    </div>
  );
}

function PresetStrip({
  presets,
  onSelect,
}: {
  presets: PresetSummary[];
  onSelect: (preset: PresetSummary) => Promise<void>;
}) {
  return (
    <section className="preset-strip" aria-label="Hazır taramalar">
      <p>Yayınlanmış taramalar</p>
      <div>
        {presets.length ? (
          presets.map((preset) => (
            <button
              type="button"
              key={preset.code}
              onClick={() => void onSelect(preset)}
            >
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </button>
          ))
        ) : (
          <span>Yayınlanmış hazır tarama bulunamadı.</span>
        )}
      </div>
    </section>
  );
}

function UniversePanel({
  rule,
  includeSymbols,
  excludeSymbols,
  onInclude,
  onExclude,
  onChange,
}: {
  rule: ScanRule;
  includeSymbols: string;
  excludeSymbols: string;
  onInclude: (value: string) => void;
  onExclude: (value: string) => void;
  onChange: (updater: (rule: ScanRule) => ScanRule) => void;
}) {
  return (
    <section
      className="workspace-section universe-section"
      aria-labelledby="universe-title"
    >
      <SectionHeading index="01" title="Evren" note="BIST · Aktif" />
      <div className="universe-fields">
        <label>
          <span>Pazar</span>
          <select value={rule.universe.market} disabled>
            <option>BIST</option>
          </select>
        </label>
        <label>
          <span>Endeks kodları</span>
          <input
            value={rule.universe.indexCodes.join(', ')}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                universe: {
                  ...current.universe,
                  indexCodes: splitList(event.target.value),
                },
              }))
            }
            placeholder="XU100, XU030"
          />
        </label>
        <label>
          <span>Sektör kimlikleri</span>
          <input
            value={rule.universe.sectorIds.join(', ')}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                universe: {
                  ...current.universe,
                  sectorIds: splitList(event.target.value),
                },
              }))
            }
            placeholder="bankacilik"
          />
        </label>
        <label>
          <span>Dahil semboller</span>
          <input
            value={includeSymbols}
            onChange={(event) => onInclude(event.target.value.toUpperCase())}
            placeholder="THYAO, ASELS"
          />
          <small>Önizleme filtresi</small>
        </label>
        <label>
          <span>Hariç semboller</span>
          <input
            value={excludeSymbols}
            onChange={(event) => onExclude(event.target.value.toUpperCase())}
            placeholder="XYZ"
          />
          <small>Önizleme filtresi</small>
        </label>
      </div>
    </section>
  );
}

function GroupEditor({
  group,
  indicators,
  operators,
  errors,
  root,
  onUpdate,
  onAdd,
  onRemove,
  onMove,
}: {
  group: GroupNode;
  indicators: IndicatorDefinition[];
  operators: OperatorDefinition[];
  errors: { nodeId?: string; message: string }[];
  root?: boolean;
  onUpdate: (id: string, updater: (node: RuleNode) => RuleNode) => void;
  onAdd: (id: string, child: RuleNode) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const first = indicators[0]!;
  return (
    <div
      className={clsx('rule-group', root && 'root-group')}
      data-node-id={group.nodeId}
    >
      <div className="group-toolbar">
        <div className="logic-control" aria-label="Grup mantığı">
          <button
            type="button"
            className={group.operator === 'AND' ? 'active' : ''}
            onClick={() =>
              onUpdate(group.nodeId, (node) => ({
                ...(node as GroupNode),
                operator: 'AND',
              }))
            }
          >
            VE
          </button>
          <button
            type="button"
            className={group.operator === 'OR' ? 'active' : ''}
            onClick={() =>
              onUpdate(group.nodeId, (node) => ({
                ...(node as GroupNode),
                operator: 'OR',
              }))
            }
          >
            VEYA
          </button>
        </div>
        <span>{root ? 'Kök grup' : 'Alt grup'}</span>
        <div className="node-actions">
          <button
            type="button"
            onClick={() => onAdd(group.nodeId, condition(first))}
          >
            + Koşul
          </button>
          <button
            type="button"
            onClick={() =>
              onAdd(group.nodeId, {
                type: 'group',
                nodeId: nodeId('group'),
                operator: 'AND',
                children: [condition(first)],
              })
            }
          >
            + Grup
          </button>
          {!root && (
            <button
              type="button"
              onClick={() => onRemove(group.nodeId)}
              aria-label="Grubu sil"
            >
              Sil
            </button>
          )}
        </div>
      </div>
      <div className="group-children">
        {group.children.map((child, index) =>
          child.type === 'group' ? (
            <GroupEditor
              key={child.nodeId}
              group={child}
              indicators={indicators}
              operators={operators}
              errors={errors}
              onUpdate={onUpdate}
              onAdd={onAdd}
              onRemove={onRemove}
              onMove={onMove}
            />
          ) : (
            <ConditionEditor
              key={child.nodeId}
              node={child}
              indicators={indicators}
              operators={operators}
              error={
                errors.find((item) => item.nodeId === child.nodeId)?.message
              }
              first={index === 0}
              last={index === group.children.length - 1}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onMove={onMove}
            />
          ),
        )}
      </div>
      {errors.find((item) => item.nodeId === group.nodeId) && (
        <p className="node-error" role="alert">
          {errors.find((item) => item.nodeId === group.nodeId)?.message}
        </p>
      )}
    </div>
  );
}

function ConditionEditor({
  node,
  indicators,
  operators,
  error,
  first,
  last,
  onUpdate,
  onRemove,
  onMove,
}: {
  node: ConditionNode;
  indicators: IndicatorDefinition[];
  operators: OperatorDefinition[];
  error: string | undefined;
  first: boolean;
  last: boolean;
  onUpdate: (id: string, updater: (node: RuleNode) => RuleNode) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  const definition = operators.find((item) => item.code === node.operator);
  const crossOperator = isCrossOperator(node.operator);
  const rightIndicator =
    node.right?.type === 'indicator' ? node.right : node.left;
  const patch = (partial: Partial<ConditionNode>) =>
    onUpdate(node.nodeId, (current) => ({
      ...(current as ConditionNode),
      ...partial,
    }));
  return (
    <div className={clsx('condition-row', error && 'has-error')}>
      <span className="condition-grip" aria-hidden="true">
        ··
      </span>
      <label>
        <span className="sr-only">İndikatör</span>
        <select
          aria-label="İndikatör"
          value={`${node.left.code}:${node.left.version}`}
          onChange={(event) => {
            const [code, version] = event.target.value.split(':');
            const indicator = indicators.find(
              (item) => item.code === code && item.version === Number(version),
            );
            if (indicator) patch({ left: condition(indicator).left });
          }}
        >
          {indicators.map((item) => (
            <option
              key={`${item.code}-${item.version}`}
              value={`${item.code}:${item.version}`}
            >
              {item.code} · {item.name}
            </option>
          ))}
        </select>
      </label>
      {numberParameter(node.left, 'period') !== undefined && (
        <label>
          <span className="sr-only">Sol periyot</span>
          <input
            aria-label="Sol periyot"
            type="number"
            min={1}
            value={numberParameter(node.left, 'period')}
            onChange={(event) =>
              patch({
                left: {
                  ...node.left,
                  parameters: {
                    ...node.left.parameters,
                    period: event.target.valueAsNumber,
                  },
                },
              })
            }
          />
        </label>
      )}
      <label>
        <span className="sr-only">Zaman dilimi</span>
        <select
          aria-label="Zaman dilimi"
          value={node.left.timeframe}
          onChange={(event) =>
            patch({
              left: {
                ...node.left,
                timeframe: event.target.value as Timeframe,
              },
            })
          }
        >
          {timeframes.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Operatör</span>
        <select
          aria-label="Operatör"
          value={node.operator}
          onChange={(event) => {
            const op = operators.find(
              (item) => item.code === event.target.value,
            )!;
            onUpdate(node.nodeId, (current) =>
              applyOperator(current as ConditionNode, op),
            );
          }}
        >
          {operators
            .filter((item) => item.valueType === 'number')
            .map((item) => (
              <option key={item.code} value={item.code}>
                {operatorLabels[item.code] ?? item.code}
              </option>
            ))}
        </select>
      </label>
      {definition?.arity !== 1 && !crossOperator && (
        <label>
          <span className="sr-only">Karşılaştırma değeri</span>
          <input
            aria-label="Karşılaştırma değeri"
            type="number"
            value={node.right?.type === 'constantNumber' ? node.right.value : 0}
            onChange={(event) =>
              patch({
                right: {
                  type: 'constantNumber',
                  value: event.target.valueAsNumber,
                },
              })
            }
          />
        </label>
      )}
      {definition?.arity !== 1 && crossOperator && (
        <>
          <label>
            <span className="sr-only">Sağ indikatör</span>
            <select
              aria-label="Sağ indikatör"
              value={`${rightIndicator.code}:${rightIndicator.version}`}
              onChange={(event) => {
                const [code, version] = event.target.value.split(':');
                const indicator = indicators.find(
                  (item) =>
                    item.code === code && item.version === Number(version),
                );
                if (indicator) patch({ right: condition(indicator).left });
              }}
            >
              {indicators.map((item) => (
                <option
                  key={`${item.code}-${item.version}`}
                  value={`${item.code}:${item.version}`}
                >
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Sağ zaman dilimi</span>
            <select
              aria-label="Sağ zaman dilimi"
              value={rightIndicator.timeframe}
              onChange={(event) =>
                patch({
                  right: {
                    ...rightIndicator,
                    timeframe: event.target.value as Timeframe,
                  },
                })
              }
            >
              {timeframes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          {numberParameter(rightIndicator, 'period') !== undefined && (
            <label>
              <span className="sr-only">Sağ periyot</span>
              <input
                aria-label="Sağ periyot"
                type="number"
                min={1}
                value={numberParameter(rightIndicator, 'period')}
                onChange={(event) =>
                  patch({
                    right: {
                      ...rightIndicator,
                      parameters: {
                        ...rightIndicator.parameters,
                        period: event.target.valueAsNumber,
                      },
                    },
                  })
                }
              />
            </label>
          )}
        </>
      )}
      {definition?.arity === 3 && (
        <label>
          <span className="sr-only">Üst değer</span>
          <input
            aria-label="Üst değer"
            type="number"
            value={node.upperBound?.value ?? 0}
            onChange={(event) =>
              patch({
                upperBound: {
                  type: 'constantNumber',
                  value: event.target.valueAsNumber,
                },
              })
            }
          />
        </label>
      )}
      {definition?.requiredOption && (
        <label>
          <span className="sr-only">{definition.requiredOption}</span>
          <input
            aria-label={
              definition.requiredOption === 'period' ? 'Periyot' : 'Yüzde'
            }
            type="number"
            value={node.options?.[definition.requiredOption] ?? 1}
            onChange={(event) =>
              patch({
                options: {
                  [definition.requiredOption!]: event.target.valueAsNumber,
                },
              })
            }
          />
        </label>
      )}
      <div className="condition-actions">
        <button
          type="button"
          disabled={first}
          onClick={() => onMove(node.nodeId, -1)}
          aria-label="Koşulu yukarı taşı"
        >
          ↑
        </button>
        <button
          type="button"
          disabled={last}
          onClick={() => onMove(node.nodeId, 1)}
          aria-label="Koşulu aşağı taşı"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => onRemove(node.nodeId)}
          aria-label="Koşulu sil"
        >
          ×
        </button>
      </div>
      {error && (
        <p className="node-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function RunPanel({
  run,
  progress,
  submitError,
  onCancel,
  cancelling,
}: {
  run: ScanRun | null;
  progress: ScanRun['progress'] | undefined;
  submitError: Error | null;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const state = submitError ? 'failed' : run?.status;
  const message =
    state === 'failed'
      ? `Tarama tamamlanamadı · ${run?.errorCode ?? submitError?.message ?? 'Bilinmeyen hata'}`
      : state === 'cancelled'
        ? 'Tarama iptal edildi. Son işlenen ilerleme korunuyor.'
        : state === 'expired'
          ? 'Tarama sonucu artık erişilebilir değil.'
          : state === 'completed'
            ? 'Tarama tamamlandı.'
            : 'Evren taranıyor…';
  return (
    <section className={clsx('run-panel', state)} aria-live="polite">
      <div>
        <p className="section-kicker">06 / Çalışma durumu</p>
        <h2>{message}</h2>
        {progress && (
          <p>
            {progress.processed.toLocaleString('tr-TR')} /{' '}
            {progress.total.toLocaleString('tr-TR')} sembol · {progress.matched}{' '}
            eşleşme · {progress.notEvaluable} değerlendirilemedi{' '}
            {progress.stale && '· Kalıcı kaynaktan güncelleniyor'}
          </p>
        )}
      </div>
      {progress && (
        <div className="progress-block">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <strong>{progress.percent}%</strong>
        </div>
      )}
      {run && !terminalStatuses.has(run.status) && (
        <button
          className="button ghost danger"
          type="button"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? 'İptal ediliyor…' : 'İptal et'}
        </button>
      )}
    </section>
  );
}

function ResultsSection({
  run,
  results,
  loading,
  error,
  density,
  sort,
  watched,
  hasMore,
  loadingMore,
  onMore,
  onDensity,
  onSort,
  onWatch,
  onExplain,
}: {
  run: ScanRun | null;
  results: ScanResult[];
  loading: boolean;
  error: Error | null;
  density: 'comfortable' | 'compact';
  sort: 'rank' | 'symbol';
  watched: Set<string>;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onDensity: (value: 'comfortable' | 'compact') => void;
  onSort: (value: 'rank' | 'symbol') => void;
  onWatch: (id: string) => void;
  onExplain: (result: ScanResult) => void;
}) {
  const noResults =
    run?.status === 'completed' && !loading && !error && results.length === 0;
  return (
    <section className="results-section" aria-labelledby="results-title">
      <div className="results-heading">
        <div>
          <p className="section-kicker">07 / Sonuçlar</p>
          <h2 id="results-title">Eşleşmeler</h2>
        </div>
        <div className="table-controls">
          <label>
            Sırala{' '}
            <select
              value={sort}
              onChange={(event) =>
                onSort(event.target.value as 'rank' | 'symbol')
              }
            >
              <option value="rank">Sıra</option>
              <option value="symbol">Sembol</option>
            </select>
          </label>
          <label>
            Yoğunluk{' '}
            <select
              value={density}
              onChange={(event) =>
                onDensity(event.target.value as 'comfortable' | 'compact')
              }
            >
              <option value="comfortable">Rahat</option>
              <option value="compact">Kompakt</option>
            </select>
          </label>
        </div>
      </div>
      {!run && (
        <EmptyState
          title="Henüz bir tarama çalıştırılmadı."
          text="Kuralı doğrulayıp çalıştırdığınızda eşleşmeler burada görünür."
        />
      )}
      {loading && (
        <EmptyState
          title="Sonuçlar yükleniyor…"
          text="Tamamlanan taramanın sonuç sayfası alınıyor."
        />
      )}
      {error && <EmptyState title="Sonuçlar alınamadı." text={error.message} />}
      {noResults && (
        <EmptyState
          title="Bu kuralla eşleşme bulunamadı."
          text="Evreni veya koşul eşiklerini genişletip yeniden deneyin."
        />
      )}
      {results.length > 0 && (
        <>
          <div className="table-scroll">
            <table className={density === 'compact' ? 'compact' : ''}>
              <thead>
                <tr>
                  <th>Sembol / Şirket</th>
                  <th>Son</th>
                  <th>Değişim</th>
                  <th>Hacim</th>
                  <th>Rel. hacim</th>
                  <th>Durum</th>
                  <th>Veri zamanı</th>
                  <th>
                    <span className="sr-only">İşlemler</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const values = result.computedValues;
                  const symbol =
                    stringValue(values.symbol) ??
                    result.instrumentId.slice(0, 8).toUpperCase();
                  return (
                    <tr
                      key={result.id}
                      className={
                        result.status === 'notEvaluable' ? 'not-evaluable' : ''
                      }
                    >
                      <td>
                        <strong>{symbol}</strong>
                        <span>
                          {stringValue(values.companyName) ?? 'BIST enstrümanı'}
                        </span>
                      </td>
                      <td>{numberValue(values.lastPrice)}</td>
                      <td
                        className={
                          Number(values.changePercent) >= 0
                            ? 'positive'
                            : 'negative'
                        }
                      >
                        {numberValue(values.changePercent, '%')}
                      </td>
                      <td>{numberValue(values.volume)}</td>
                      <td>{numberValue(values.relativeVolume, '×')}</td>
                      <td>
                        <span className={clsx('result-status', result.status)}>
                          {result.status === 'notEvaluable'
                            ? 'Değerlendirilemedi'
                            : 'Eşleşti'}
                        </span>
                      </td>
                      <td>
                        {new Intl.DateTimeFormat('tr-TR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(new Date(result.dataCutoffAt))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`${symbol} açıklamasını aç`}
                          onClick={() => onExplain(result)}
                        >
                          Açıklama
                        </button>
                        <button
                          type="button"
                          className={clsx(
                            'watch-button',
                            watched.has(result.instrumentId) && 'active',
                          )}
                          aria-label={`${symbol} izleme listesi`}
                          onClick={() => onWatch(result.instrumentId)}
                        >
                          ☆
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="pagination-row">
              <button
                className="button ghost"
                type="button"
                disabled={loadingMore}
                onClick={onMore}
              >
                {loadingMore ? 'Yükleniyor…' : 'Daha fazla sonuç'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span>—</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function ExplanationDialog({
  dialog,
  result,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  result: ScanResult | null;
}) {
  return (
    <dialog className="drawer-dialog" ref={dialog} onClose={() => undefined}>
      <div className="drawer-head">
        <div>
          <p className="section-kicker">Sonuç açıklaması</p>
          <h2>
            {stringValue(result?.computedValues.symbol) ??
              result?.instrumentId.slice(0, 8).toUpperCase()}
          </h2>
        </div>
        <button
          type="button"
          aria-label="Açıklamayı kapat"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
      </div>
      {result && (
        <div className="drawer-body">
          <span className={clsx('result-status', result.status)}>
            {result.status === 'notEvaluable'
              ? 'Değerlendirilemedi'
              : 'Eşleşti'}
          </span>
          {result.status === 'notEvaluable' && (
            <div className="drawer-callout">
              <strong>Neden değerlendirilemedi?</strong>
              <p>
                Eksik veri, yetersiz warm-up veya indikatör çıktısının boş
                olması koşulu hesaplanamaz hale getirdi.
              </p>
            </div>
          )}
          <section>
            <h3>Koşul değerlendirmesi</h3>
            <KeyValues
              value={
                result.explanation ?? { durum: 'Açıklama verisi bulunmuyor.' }
              }
            />
          </section>
          <section>
            <h3>Hesaplanan değerler</h3>
            <KeyValues value={result.computedValues} />
          </section>
          {result.warnings.length > 0 && (
            <section>
              <h3>Uyarılar</h3>
              <pre>{JSON.stringify(result.warnings, null, 2)}</pre>
            </section>
          )}
          <p className="drawer-time">
            Veri kesim zamanı ·{' '}
            {new Date(result.dataCutoffAt).toLocaleString('tr-TR')}
          </p>
        </div>
      )}
    </dialog>
  );
}

function KeyValues({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="key-values">
      {Object.entries(value).map(([keyName, item]) => (
        <div key={keyName}>
          <dt>{keyName}</dt>
          <dd>{displayValue(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SaveDialog({
  dialog,
  rule,
}: {
  dialog: React.RefObject<HTMLDialogElement | null>;
  rule: ScanRule;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const save = useMutation({
    mutationFn: () =>
      scannerApi.save({ name, description, tags: splitList(tags), rule }),
  });
  return (
    <dialog className="save-dialog" ref={dialog}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="dialog-title">
          <div>
            <p className="section-kicker">Özel tarama</p>
            <h2>Taramayı kaydet</h2>
          </div>
          <button
            type="button"
            aria-label="Kaydetme penceresini kapat"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        {save.isSuccess ? (
          <div className="save-success" role="status">
            <strong>Tarama kaydedildi.</strong>
            <p>
              Revision {save.data.currentRevision} oluşturuldu. Görünürlük
              yalnızca size özel.
            </p>
            <button
              className="button primary"
              type="button"
              onClick={() => dialog.current?.close()}
            >
              Tamam
            </button>
          </div>
        ) : (
          <>
            <label>
              <span>Ad</span>
              <input
                required
                maxLength={160}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <label>
              <span>Açıklama</span>
              <textarea
                maxLength={4000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              <span>Etiketler</span>
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="momentum, günlük"
              />
            </label>
            {save.error && (
              <p className="form-error" role="alert">
                {save.error.message === 'SAVED_SCAN_CONFLICT'
                  ? 'Tarama başka bir oturumda güncellendi. Son revision’ı yükleyip tekrar deneyin.'
                  : `Kaydedilemedi: ${save.error.message}`}
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() => dialog.current?.close()}
              >
                Vazgeç
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={save.isPending}
              >
                {save.isPending ? 'Kaydediliyor…' : 'Özel olarak kaydet'}
              </button>
            </div>
          </>
        )}
      </form>
    </dialog>
  );
}

function mergeProgress(
  previous: ScanRun['progress'] | null,
  next: ScanRun['progress'],
): ScanRun['progress'] {
  if (!previous) return next;
  return {
    ...next,
    total: Math.max(previous.total, next.total),
    processed: Math.max(previous.processed, next.processed),
    matched: Math.max(previous.matched, next.matched),
    notEvaluable: Math.max(previous.notEvaluable, next.notEvaluable),
    warnings: Math.max(previous.warnings, next.warnings),
    percent: Math.max(previous.percent, next.percent),
  };
}
function countNodes(node: RuleNode): number {
  return (
    1 +
    (node.type === 'group'
      ? node.children.reduce((sum, child) => sum + countNodes(child), 0)
      : 0)
  );
}
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function numberValue(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(value)}${suffix}`
    : '—';
}
function sortResults(results: ScanResult[], sort: 'rank' | 'symbol') {
  return [...results].sort((left, right) =>
    sort === 'rank'
      ? (left.rank ?? 9999) - (right.rank ?? 9999)
      : (
          stringValue(left.computedValues.symbol) ?? left.instrumentId
        ).localeCompare(
          stringValue(right.computedValues.symbol) ?? right.instrumentId,
        ),
  );
}
function toggleSet(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
function applyOperator(
  node: ConditionNode,
  operator: OperatorDefinition,
): ConditionNode {
  const next: ConditionNode = { ...node, operator: operator.code };
  if (operator.arity === 1) delete next.right;
  else if (isCrossOperator(operator.code)) {
    if (next.right?.type !== 'indicator') {
      next.right = {
        ...node.left,
        parameters: { ...node.left.parameters },
      };
    }
  } else if (next.right?.type !== 'constantNumber') {
    next.right = { type: 'constantNumber', value: 50 };
  }
  if (operator.arity === 3)
    next.upperBound ??= { type: 'constantNumber', value: 70 };
  else delete next.upperBound;
  if (operator.requiredOption)
    next.options = {
      [operator.requiredOption]: operator.requiredOption === 'period' ? 20 : 5,
    };
  else delete next.options;
  return next;
}
function isCrossOperator(operator: string): boolean {
  return operator === 'CROSSES_ABOVE' || operator === 'CROSSES_BELOW';
}
function numberParameter(
  operand: IndicatorOperand,
  parameter: string,
): number | undefined {
  const value = operand.parameters[parameter];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
function displayValue(value: unknown): string {
  if (value === null) return '—';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  if (typeof value === 'undefined') return '—';
  try {
    return JSON.stringify(value);
  } catch {
    return 'Gösterilemeyen değer';
  }
}
