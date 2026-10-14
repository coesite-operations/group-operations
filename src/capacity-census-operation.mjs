import { assessAllocationReadiness, planNonoverlappingAllocations } from '@union-officer-academy/union-officer-academy/allocation-readiness';

const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const date = x => nonempty(x) && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
const fields = (o, names) => names.filter(k => !nonempty(o?.[k]));

/** A reusable Coesite runbook—not an office appointment or new authorization. */
export function bindCapacityCensusProcedure(template, binding) {
  const missingTemplate = fields(template, ['id', 'version', 'duty', 'scienceBasis', 'engineeringBasis', 'providerKind', 'receivingOffice']);
  const missingBinding = fields(binding, ['workRef', 'principal', 'office', 'actorId', 'scope', 'expectedDate', 'provider', 'receiverActorId', 'sourceRevision']);
  if (missingTemplate.length || missingBinding.length || !date(binding?.expectedDate))
    throw new TypeError('incomplete operating contract: ' + [...missingTemplate.map(k => 'template.'+k), ...missingBinding.map(k => 'binding.'+k), ...(!date(binding?.expectedDate) ? ['binding.expectedDate calendar'] : [])].join(', '));
  if (binding.actorId === binding.receiverActorId)
    throw new TypeError('executing actor cannot be own independent receiver');
  if (binding.permittedEffects !== undefined && (!Array.isArray(binding.permittedEffects) || binding.permittedEffects.some(e => e !== 'observe' && e !== 'report')))
    throw new TypeError('capacity observation procedure cannot grant provider mutations');
  const permittedEffects = binding.permittedEffects ?? ['observe', 'report'];
  return Object.freeze({
    kind: 'coesite.operating-procedure.binding.v1',
    template: Object.freeze({ ...template }),
    binding: Object.freeze({ ...binding, permittedEffects: Object.freeze([...permittedEffects]) }),
  });
}

/** Native provider, provider verifier, delivery and independent receiver are distinct adapters.
 * A self-described JSON field is not provider authentication or Group receiving.
 */
export async function executeCapacityCensusProcedure(instance, {
  readCensus, verifyProvider, deliverToGroup, verifyGroupReceipt,
} = {}) {
  if (instance?.kind !== 'coesite.operating-procedure.binding.v1') throw new TypeError('bound operating contract required');
  const { template, binding: b } = instance;
  const permittedEffects = new Set(b.permittedEffects ?? []);
  const out = {
    kind: 'coesite.group-capacity-evidence.v1', workRef: b.workRef, principal: b.principal,
    office: b.office, actorId: b.actorId, receiver: template.receivingOffice,
    expectedReceiverActorId: b.receiverActorId, expectedDate: b.expectedDate,
    scope: b.scope, provider: b.provider, sourceRevision: b.sourceRevision,
    templateId: template.id, templateVersion: template.version, duty: template.duty,
    scienceBasis: template.scienceBasis, engineeringBasis: template.engineeringBasis,
    providerEvidence: 'UNKNOWN', capacityState: 'UNKNOWN',
    delivery: 'NOT_ATTEMPTED', groupAcceptance: 'NOT_VERIFIED',
    cost: 'UNKNOWN', runtimeRevision: 'UNKNOWN',
  };
  const deliver = async () => {
    if (!permittedEffects.has('report')) return Object.freeze(out);
    // Delivery of UNKNOWN findings is useful; it is not recipient acceptance.
    if (typeof deliverToGroup === 'function') {
      let receipt;
      try {
        receipt = await deliverToGroup(Object.freeze({ ...out }));
      } catch (err) {
        out.delivery = 'FAILED'; out.deliveryFailureLayer = err?.layer ?? 'UNKNOWN';
        return Object.freeze(out);
      }
      out.delivery = nonempty(receipt?.receiptId) ? 'REPORTED_UNVERIFIED' : 'NOT_CONFIRMED';
      out.deliveryReceiptId = nonempty(receipt?.receiptId) ? receipt.receiptId : undefined;
      if (nonempty(receipt?.receiptId) && typeof verifyGroupReceipt === 'function' &&
          receipt?.receiverActorId !== b.actorId && receipt?.receiverActorId === b.receiverActorId) {
        try {
          const judgement = await verifyGroupReceipt(receipt, {workRef:b.workRef, sourceRevision:b.sourceRevision});
          if (judgement === true && receipt?.verdict === 'ACCEPTED') {
            out.delivery = 'RECEIVED'; out.groupAcceptance = 'INDEPENDENTLY_VERIFIED';
          } else if (judgement === true) {
            out.delivery = 'RECEIVED'; out.groupAcceptance = 'NOT_ACCEPTED';
          }
        } catch (err) {
          // Verification failure cannot erase an already acknowledged delivery.
          out.receivingVerificationFailureLayer = err?.layer ?? 'UNKNOWN';
        }
      }
    }
    return Object.freeze(out);
  };
  if (!permittedEffects.has('observe')) {
    out.exception = 'observation-effect-not-permitted';
    return deliver();
  }
  if (typeof readCensus !== 'function') {
    out.exception = 'native-census-adapter-unavailable';
    return deliver();
  }
  let observation;
  try {
    observation = await readCensus({ provider: b.provider, scope: b.scope, expectedDate: b.expectedDate });
  } catch (err) {
    out.exception = 'native-census-read-failed';
    out.failureLayer = err?.layer ?? 'CONNECTOR_OR_PROVIDER_UNKNOWN';
    return deliver();
  }
  if (!observation || !Array.isArray(observation.pages)) {
    out.exception = 'invalid-census-envelope';
    return deliver();
  }
  const assay = assessAllocationReadiness(observation.pages, { expectedDate: b.expectedDate });
  out.analyticalResult = assay;
  let witnessed = false;
  if (observation.origin === 'native-provider' && typeof verifyProvider === 'function') {
    try {
      witnessed = await verifyProvider(observation.provenance, { workRef: b.workRef, provider: b.provider, expectedDate: b.expectedDate }) === true;
    } catch { witnessed = false; }
  }
  if (witnessed) {
    out.providerEvidence = 'NATIVE_VERIFIED';
    out.capacityState = assay.state;
    out.runtimeRevision = nonempty(observation.runtimeRevision) ? observation.runtimeRevision : 'UNKNOWN';
    // The authored/native census is separately authenticated before a
    // projected allocation may be called a feasible candidate. This is a
    // maximum-cardinality finite *work-to-character* matching, not a new
    // allocation, promise, authority grant, or compute-token capacity claim.
    // Preserve even its deficit as a receiving signal so the consuming
    // enterprise can source the specific missing role instead of counting
    // every eligible work scope as simultaneously executable.
    if (assay.state === 'SOME_ALLOCATABLE') {
      out.matchingPressure = planNonoverlappingAllocations(observation.pages, {
        expectedDate: b.expectedDate
      });
    }
  } else {
    out.providerEvidence = 'UNVERIFIED';
    out.capacityState = 'UNKNOWN';
    out.exception = 'native-provider-witness-missing';
  }
  return deliver();
}
