/**
 * Bounded projection of one COMPLETE, already-persisted signed Kalshi account
 * observation. This is not a new venue client or ledger: the source is the
 * existing trading-fleet Kalshi observation file, addressed by its SHA-256.
 *
 * A large venue account may contain millions of bytes of positions, fills,
 * orders and settlements. Never push those arrays through an RPC result: it
 * can exceed the canonical ActivityPub/MetroPlat message envelope, causing a
 * successful source read to look like a failed observation.
 *
 * Preserving the original full file is REQUIRED before calling this function.
 * This projection is a truthful index into that evidence, not a reconciliation
 * verdict or permission to trade.
 */
const requiredRows = (value, field) => {
  if (!Array.isArray(value)) throw new TypeError(`Kalshi ${field} rows have not been received`);
  return value.length;
};

const accountAmounts = (balance) => {
  if (!balance || typeof balance !== 'object' || Array.isArray(balance))
    throw new TypeError('Kalshi signed balance has not been received');
  const selected = {};
  // Scalar account values only. Never project opaque provider or credential
  // fields, independent of how much detail the original source has.
  for (const key of [
    'balance', 'balance_dollars', 'portfolio_value', 'portfolio_value_dollars',
    'available_balance', 'available_balance_dollars',
  ]) {
    const value = balance[key];
    if ((typeof value === 'string' && value.length > 0 && value.length <= 64)
      || (typeof value === 'number' && Number.isFinite(value))) selected[key] = value;
  }
  return selected;
};

/** Create an envelope-sized account observation from a source record durably held by SHA. */
export function kalshiFleetReceiptOf(stored) {
  if (stored?.type !== 'KalshiFleetAccountObservation'
    || !/^[a-f0-9]{64}$/u.test(stored.fleetRecord ?? '')
    || !Number.isFinite(Date.parse(stored.observedAt)))
    throw new TypeError('persisted signed Kalshi observation and fleet identity are required');

  const counts = {
    positions: requiredRows(stored.positions, 'position'),
    restingOrders: requiredRows(stored.orders, 'resting order'),
    recentFills: requiredRows(stored.fills, 'fill'),
    recentSettlements: requiredRows(stored.settlements, 'settlement'),
  };
  const accounting = stored.settlementAccounting;
  if (!accounting || typeof accounting !== 'object'
    || !Array.isArray(accounting.records) || !Array.isArray(accounting.refusals)
    || accounting.accountCashReconciled !== false)
    throw new TypeError('Kalshi settlement receiving status is missing or inconsistent');
  const authority = stored.mandatePolicyReadiness;
  if (!authority || typeof authority.allowed !== 'boolean')
    throw new TypeError('Kalshi policy authority was not observed');

  const receipt = {
    kind: 'kalshi.fleet.account-observation-receipt',
    source: 'signed-Kalshi-account-API',
    observedAt: stored.observedAt,
    ...(stored.collectionStartedAt ? { collectionStartedAt: stored.collectionStartedAt } : {}),
    fleetRecord: stored.fleetRecord,
    retainedFullRecord: true,
    balance: accountAmounts(stored.balance),
    counts,
    scopes: {
      positions: 'nonzero-positions-filter',
      orders: 'resting-only',
      fills: 'seven-day-window',
      settlements: 'seven-day-window',
      completeness: 'only the records returned by the current venue client; no historical completeness asserted',
    },
    reconciliation: {
      settlementsEvaluated: accounting.records.length,
      settlementRefusals: accounting.refusals.length,
      accountCashReconciled: false,
      realizedProfitVerified: false,
    },
    policy: {
      allowed: authority.allowed,
      reason: typeof authority.reason === 'string' ? authority.reason.slice(0, 160) : null,
      deskArmingObserved: false,
    },
    orderEffect: false,
  };
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 4_096)
    throw new TypeError('Kalshi receipt exceeds the bounded carrier');
  return Object.freeze(receipt);
}
