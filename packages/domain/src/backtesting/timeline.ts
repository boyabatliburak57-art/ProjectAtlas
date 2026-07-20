import { createStableParameterHash } from '../indicators/parameter-hash.js';
import type { BacktestTimelineEvent } from './contracts.js';
import { BacktestDomainError } from './contracts.js';

const EVENT_PRIORITY: Readonly<Record<BacktestTimelineEvent['type'], number>> =
  {
    corporateAction: 1,
    forcedExit: 2,
    bar: 6,
  };

export interface OrderedBacktestTimeline {
  readonly events: readonly BacktestTimelineEvent[];
  readonly hash: string;
  readonly duplicateEventIds: readonly string[];
}

export function createOrderedBacktestTimeline(
  input: readonly BacktestTimelineEvent[],
): OrderedBacktestTimeline {
  const seenIds = new Set<string>();
  const duplicateEventIds: string[] = [];
  const timestampValidity = new Map<string, boolean>();
  let uniqueEvents: BacktestTimelineEvent[] | null = null;
  let duplicateLookup: Map<string, BacktestTimelineEvent> | null = null;
  let ordered = true;
  let previousUnique: BacktestTimelineEvent | undefined;
  for (const [index, event] of input.entries()) {
    validateEvent(event, timestampValidity);
    if (!seenIds.has(event.eventId)) {
      seenIds.add(event.eventId);
      if (
        previousUnique !== undefined &&
        compareBacktestEvents(previousUnique, event) > 0
      )
        ordered = false;
      previousUnique = event;
      uniqueEvents?.push(event);
      duplicateLookup?.set(event.eventId, event);
      continue;
    }
    if (uniqueEvents === null) uniqueEvents = input.slice(0, index);
    duplicateLookup ??= new Map(
      uniqueEvents.map((item) => [item.eventId, item]),
    );
    const existing = duplicateLookup.get(event.eventId)!;
    if (
      createStableParameterHash(existing) !== createStableParameterHash(event)
    ) {
      throw new BacktestDomainError('BACKTEST_EVENT_INVALID', {
        eventId: event.eventId,
        reason: 'duplicate_event_id_payload_mismatch',
      });
    }
    duplicateEventIds.push(event.eventId);
  }
  const insertionOrderedEvents = uniqueEvents ?? input;
  const events = ordered
    ? insertionOrderedEvents
    : [...insertionOrderedEvents].sort(compareBacktestEvents);
  return {
    events,
    hash: createTimelineHash(events),
    duplicateEventIds: [...new Set(duplicateEventIds)].sort(),
  };
}

/**
 * Streams every semantic event field through two independent 32-bit FNV-1a
 * accumulators. Length-prefixed fields prevent concatenation ambiguity. This is
 * intentionally allocation-bounded: a five-year full-universe timeline must not
 * first become a hundreds-of-megabytes canonical JSON string merely to hash it.
 */
function createTimelineHash(events: readonly BacktestTimelineEvent[]): string {
  let first = 0x81_1c_9d_c5;
  let second = 0x9e_37_79_b9;
  const updateByte = (value: number): void => {
    first = Math.imul(first ^ value, 0x01_00_01_93) >>> 0;
    second = Math.imul(second ^ value, 0x01_00_01_93) >>> 0;
  };
  const update = (value: string): void => {
    let length = value.length;
    do {
      updateByte(length & 0xff);
      length >>>= 8;
    } while (length > 0);
    updateByte(0xff);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      updateByte(code & 0xff);
      updateByte(code >>> 8);
    }
    updateByte(0xfe);
  };
  update('backtest-timeline-v2');
  for (const event of events) updateTimelineEvent(event, update);
  return `fnv1a64:${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function updateTimelineEvent(
  event: BacktestTimelineEvent,
  update: (value: string) => void,
): void {
  update(event.type);
  update(event.eventId);
  update(event.instrumentId);
  update(event.symbol);
  update(event.timestamp);
  if (event.type === 'bar') {
    update(event.open ?? '');
    update(event.high ?? '');
    update(event.low ?? '');
    update(event.close ?? '');
    update(event.volume ?? '');
    update(event.isClosed ? '1' : '0');
    update(event.revision ?? '');
    update(event.revisionAvailableAt ?? '');
    return;
  }
  if (event.type === 'forcedExit') {
    update(event.price ?? '');
    update(event.reason);
    return;
  }
  update(event.actionType);
  update(event.announcementAt);
  update(event.exAt);
  update(event.effectiveAt);
  update(event.paymentAt ?? '');
  update(event.revision);
  update(event.revisionAvailableAt);
  update(event.factor ?? '');
  update(event.cashPerShare ?? '');
  update(event.settlementPrice ?? '');
}

export function createBacktestEventOrderKey(
  event: BacktestTimelineEvent,
): string {
  return [
    event.timestamp,
    String(EVENT_PRIORITY[event.type]).padStart(2, '0'),
    event.instrumentId,
    event.symbol,
    event.eventId,
  ].join('|');
}

function compareBacktestEvents(
  left: BacktestTimelineEvent,
  right: BacktestTimelineEvent,
): number {
  return (
    compareText(left.timestamp, right.timestamp) ||
    EVENT_PRIORITY[left.type] - EVENT_PRIORITY[right.type] ||
    compareText(left.instrumentId, right.instrumentId) ||
    compareText(left.symbol, right.symbol) ||
    compareText(left.eventId, right.eventId)
  );
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function validateEvent(
  event: BacktestTimelineEvent,
  timestampValidity: Map<string, boolean>,
): void {
  if (
    event.eventId.length === 0 ||
    event.instrumentId.length === 0 ||
    event.symbol.length === 0 ||
    !isIsoTimestamp(event.timestamp, timestampValidity)
  ) {
    throw new BacktestDomainError('BACKTEST_EVENT_INVALID', {
      eventId: event.eventId,
    });
  }
}

function isIsoTimestamp(
  value: string,
  timestampValidity: Map<string, boolean>,
): boolean {
  const cached = timestampValidity.get(value);
  if (cached !== undefined) return cached;
  const parsed = Date.parse(value);
  const valid =
    Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  timestampValidity.set(value, valid);
  return valid;
}
