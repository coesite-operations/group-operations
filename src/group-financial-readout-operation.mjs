import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { produceGroupFinancialReadout } from "../scripts/produce-group-financial-readout.mjs";

async function produceAndFederate({ environment, clock }) {
  const result = await produceGroupFinancialReadout({ environment, now: clock });
  const recipient = environment.GROUP_PEER_ACTOR;
  if (recipient === undefined) return result;
  const { sendPeerEvidence } = await import("./peer-evidence.mjs");
  const delivery = await sendPeerEvidence({
    environment, peerActor: recipient, peerInbox: environment.GROUP_PEER_INBOX,
    objectKind: "561-group.financial-readout.v1", value: result.readout,
  });
  return Object.freeze({ ...result, delivery });
}

export function groupFinancialReadoutOperation({ environment = process.env, clock = () => new Date().toISOString() } = {}) {
  return operation({
    verb: "group-financial-readout-produce", inputFormat: "json", outputFormat: "json",
    summary: "Produce the 561 Group's daily financial readout.",
    description: "Reads already-recorded Group financial inputs, writes only the dated author-node readout, and delivers its addressed SignCell evidence to the configured peer. It does not receive payments or refresh financial books; unavailable receiver evidence remains explicit.",
    reads: ["METROPLAT_WEB_DATA_DIR", "METROPLAT_LEDGER_JOURNAL", "GROUP_WALLET_REGISTRY", "METROPLAT_AGENCY_ROOT", "GROUP_PEER_ACTOR"],
    writes: ["group-financial-readout"],
    effects: { class: "external", replay: "coordinated", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: () => produceAndFederate({ environment, clock }),
  });
}

/** Cash corroboration is a separate authorized effect, never a readout side
 * effect. Reuses Red Cup's provider checks and the Group's native journal. */
export function groupX402SellerReceivingOperation({ environment = process.env, clock = () => new Date().toISOString() } = {}) {
  return operation({
    verb: "group-x402-seller-payment-receive", inputFormat: "json", outputFormat: "json",
    summary: "Independently corroborate x402 seller cash and retain a qualified, dated observation.",
    description: "Reads seller-owned R2 witness custody and two independent Base receipt/header providers through Red Cup, retaining a bounded semantic observation in the Group's private journal. Does not post income, rewrite books, infer buyer demand or deliver paid goods.",
    reads: ["METROPLAT_DATA_ROOT", "X402_SECRETS_FILE", "CLOUDFLARE_ACCOUNT_ID", "API_KEY_CLOUDFLARE_R2_EDIT", "Base public receipt providers"],
    writes: ["561-group.x402-seller-payment-receiving"],
    effects: { class: "external", replay: "coordinated", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: async () => {
      const { receiveX402SellerPayments } = await import("../scripts/receive-x402-seller-payments.mjs");
      return receiveX402SellerPayments({ environment, now: () => new Date(clock()) });
    },
  });
}

export function groupFinancialReadoutOperations(binding) {
  return Object.freeze([
    groupX402SellerReceivingOperation({ clock: binding.now }),
    groupFinancialReadoutOperation({ clock: binding.now }),
  ]);
}
