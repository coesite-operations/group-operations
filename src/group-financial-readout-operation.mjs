import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { produceGroupFinancialReadout } from "../scripts/produce-group-financial-readout.mjs";
import { sendPeerEvidence } from "./peer-evidence.mjs";

async function produceAndFederate({ environment, clock }) {
  const result = await produceGroupFinancialReadout({ environment, now: clock });
  const recipient = environment.GROUP_PEER_ACTOR;
  if (recipient === undefined) return result;
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
    description: "Reads Group financial inputs, writes the dated author-node readout, and delivers its addressed SignCell evidence to the configured peer.",
    reads: ["METROPLAT_WEB_DATA_DIR", "METROPLAT_LEDGER_JOURNAL", "X402_SETTLEMENT_RECORDS", "X402_SECRETS_FILE", "GROUP_PEER_ACTOR"],
    writes: ["group-financial-readout"],
    effects: { class: "external", replay: "coordinated", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: () => produceAndFederate({ environment, clock }),
  });
}

export function groupFinancialReadoutOperations(binding) {
  return Object.freeze([groupFinancialReadoutOperation({ clock: binding.now })]);
}
