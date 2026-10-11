const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const validTime = value => nonempty(value) && Number.isFinite(Date.parse(value));
const missing = (value, keys) => keys.filter(key => !nonempty(value?.[key]));

/**
 * Bind an existing quota-notice reconciliation duty. An account label is NOT
 * verified ownership; a mask or procedure binding cannot create authority.
 */
export function bindProviderQuotaNoticeOperation(template, binding) {
  const absent = [
    ...missing(template, ['id', 'version', 'duty', 'scienceBasis', 'engineeringBasis', 'receivingOffice']).map(x => 'template.' + x),
    ...missing(binding, ['workRef', 'principal', 'office', 'actorId', 'receiverActorId', 'provider', 'accountRef', 'sourceRevision', 'observedAt']).map(x => 'binding.' + x),
  ];
  if (absent.length || !validTime(binding?.observedAt))
    throw new TypeError('incomplete quota operation: ' + [...absent, ...(!validTime(binding?.observedAt) ? ['binding.observedAt'] : [])].join(', '));
  if (binding.actorId === binding.receiverActorId) throw new TypeError('independent receiver must differ from executing actor');
  if (!Array.isArray(binding.permittedEffects) ||
      binding.permittedEffects.some(x => x !== 'observe' && x !== 'report'))
    throw new TypeError('explicit observe/report effects required');
  return Object.freeze({
    kind: 'coesite.provider-quota-operation.binding.v1',
    template: Object.freeze({ ...template }),
    binding: Object.freeze({ ...binding, permittedEffects: Object.freeze([...new Set(binding.permittedEffects)]) }),
  });
}

/** An alert is a source observation, never itself a current service-failure assay or invoice. */
function summarizeNotices(rows, binding) {
  if (!Array.isArray(rows)) throw new TypeError('notices must be an array');
  const ids = new Map();
  const signatures = new Set();
  const periods = new Set();
  let matching = 0, afterReset = 0;
  for (const notice of rows) {
    if (!nonempty(notice?.noticeId) || !validTime(notice?.receivedAt) ||
        !validTime(notice?.periodResetAt) || !nonempty(notice?.provider) ||
        !nonempty(notice?.accountRef) || !nonempty(notice?.operationClass) ||
        !Number.isInteger(notice?.thresholdPercent) ||
        notice.thresholdPercent < 0 || notice.thresholdPercent > 100)
      throw new TypeError('invalid provider notice envelope');
    if (notice.provider !== binding.provider || notice.accountRef !== binding.accountRef) continue;
    if (Date.parse(notice.receivedAt) > Date.parse(binding.observedAt))
      throw new TypeError('provider notice received after observation cutoff');
    matching++;
    const key = [notice.periodResetAt, notice.operationClass, notice.thresholdPercent].join('|');
    const prior = ids.get(notice.noticeId);
    if (prior && prior !== key) throw new TypeError('conflicting provider notice identity');
    ids.set(notice.noticeId, key);
    signatures.add(key);
    periods.add(notice.periodResetAt);
    if (Date.parse(notice.receivedAt) >= Date.parse(notice.periodResetAt)) afterReset++;
  }
  return {
    matchedNotifications: matching,
    distinctThresholdEvents: signatures.size,
    distinctQuotaPeriods: periods.size,
    notificationsAfterStatedReset: afterReset,
    noticeEvidence: 'PROVIDER_MESSAGE_ONLY'
  };
}

/**
 * Adapters explicitly distinguish (1) message search, (2) provider-native
 * service probe, (3) Group transport, (4) independent receiving. Unknown
 * capacity, service impact and cost remain unknown when an adapter is absent.
 */
export async function executeProviderQuotaNoticeOperation(instance, {
  readNotices, readServiceProbe, verifyServiceProbe, deliverToGroup, verifyGroupReceipt,
} = {}) {
  if (instance?.kind !== 'coesite.provider-quota-operation.binding.v1')
    throw new TypeError('bound quota operation required');
  const { template, binding: b } = instance;
  const effects = new Set(b.permittedEffects);
  const out = {
    kind: 'coesite.provider-quota-evidence.v1',
    workRef: b.workRef, sourceRevision: b.sourceRevision,
    principal: b.principal, office: b.office, actorId: b.actorId,
    receiver: template.receivingOffice, expectedReceiverActorId: b.receiverActorId,
    provider: b.provider, accountRef: b.accountRef, observedAt: b.observedAt,
    templateId: template.id, templateVersion: template.version,
    scienceBasis: template.scienceBasis, engineeringBasis: template.engineeringBasis,
    noticeSource: 'UNAVAILABLE', providerServiceState: 'UNKNOWN',
    currentCapacity: 'UNKNOWN', corporateCost: 'UNKNOWN',
    corporateExpenseRecognition: 'NOT_ESTABLISHED',
    customerDelivery: 'NOT_VERIFIED',
    delivery: 'NOT_ATTEMPTED', groupAcceptance: 'NOT_VERIFIED',
  };
  if (effects.has('observe')) {
    if (typeof readNotices === 'function') {
      try {
        const envelope = await readNotices({ provider: b.provider, accountRef: b.accountRef, observedAt: b.observedAt });
        if (!nonempty(envelope?.sourceRef)) throw new TypeError('notice source receipt missing');
        Object.assign(out, summarizeNotices(envelope.notices, b));
        out.noticeSource = 'SOURCE_READ';
        out.noticeSourceRef = envelope.sourceRef;
        out.sourceCoverage = envelope.coverage === 'COMPLETE' ? 'COMPLETE' : 'BOUNDED';
      } catch (error) {
        out.noticeSource = 'FAILED';
        out.noticeFailureClass = error instanceof TypeError ? 'INVALID_EVIDENCE' : 'READ_FAILURE';
      }
    }
    if (typeof readServiceProbe === 'function') {
      try {
        const probe = await readServiceProbe({ provider: b.provider, accountRef: b.accountRef });
        if (probe?.origin === 'native-provider' && nonempty(probe?.receiptId) &&
            probe.provider === b.provider && probe.accountRef === b.accountRef &&
            validTime(probe.observedAt) && Date.parse(probe.observedAt) <= Date.parse(b.observedAt) &&
            typeof verifyServiceProbe === 'function' &&
            await verifyServiceProbe(probe, { workRef: b.workRef, provider: b.provider }) === true) {
          out.providerServiceState = probe.operationFailed === true ? 'FAILURE_OBSERVED' : 'NO_FAILURE_OBSERVED';
          out.serviceProbeRef = probe.receiptId;
        }
      } catch { out.serviceProbeFailureClass = 'PROVIDER_READ_FAILURE'; }
    }
  } else out.exception = 'observation-effect-not-permitted';

  if (effects.has('report') && typeof deliverToGroup === 'function') {
    let receipt;
    try { receipt = await deliverToGroup(Object.freeze({ ...out })); }
    catch (error) {
      out.delivery = 'FAILED';
      out.deliveryFailureLayer = error?.layer ?? 'UNKNOWN';
      return Object.freeze(out);
    }
    if (nonempty(receipt?.receiptId)) {
      out.delivery = 'REPORTED_UNVERIFIED';
      out.deliveryReceiptId = receipt.receiptId;
      if (receipt.receiverActorId === b.receiverActorId && receipt.receiverActorId !== b.actorId &&
          typeof verifyGroupReceipt === 'function') {
        try {
          const verdict = await verifyGroupReceipt(receipt, { workRef: b.workRef, sourceRevision: b.sourceRevision });
          if (verdict === true) {
            out.delivery = 'RECEIVED';
            out.groupAcceptance = receipt.verdict === 'ACCEPTED' ? 'INDEPENDENTLY_VERIFIED' : 'NOT_ACCEPTED';
          }
        } catch (error) { out.receivingVerificationFailureLayer = error?.layer ?? 'UNKNOWN'; }
      }
    } else out.delivery = 'NOT_CONFIRMED';
  }
  return Object.freeze(out);
}
