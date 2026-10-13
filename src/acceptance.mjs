// Group Operations' close of the work loop (561 Group note of 2026-10-03, "One outcome path"):
// every judgment of the Group's delivered work is told once as an outcome (organizing/enterprise
// outcomes), the Group's derived book and its weekly acceptance readout are projections of those
// outcomes, and both are written in node state, never into the authored ledger.
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  acceptanceReadoutOf, arenaOutcomesOf, economyOf, entityOutcomeBookOf, isoWeekOf, outcomeBookText, judgedSettlementsIndexOf, marketJudgmentsIndexOf, resourcePricesAt, resourcePricesIndexOf, outcomeMarketIndexOf, outcomeSettlementsIndexOf, outcomeStandingIndexOf, standingIndexOf, standingOf, workArenaBoardAt, outcomeJournal, outcomeOf, outcomesDigestOf, partyResolverOf, territoriesOf,
} from "@red-cup-engineering/organizing/enterprise";
import { personasRootOf, readReachRecords, reachReadoutOf } from "./reach-readout.mjs";
import { pricingRootOf } from "@red-cup-engineering/computer-inference-engine/dispatch/expected-resolution-pricing-client";
import { bookSha256Of } from "./acceptance-reading.mjs";

/** The legal entity the Group's own wallets and seated enterprises sign for. */
export const GROUP_ENTITY = "561-group-llc";

const DAY_MS = 86_400_000;
const text = (value) => typeof value === "string" && value.trim() !== "";

/**
 * The accounts the house holds, from the key-management wallet registry, as `partyResolverOf`
 * reads them: an org wallet is the Group's entity, an enterprise's wallet that enterprise, a
 * founder's wallet a related party. An address the registry does not name is no party the house
 * knows, so money from it is a stranger's.
 */
export function walletAccountsOf(registry, { entity = GROUP_ENTITY, territories = [] } = {}) {
  const accounts = new Map();
  for (const wallet of registry?.wallets ?? []) {
    if (!/^0x[0-9a-f]{40}$/iu.test(wallet?.address ?? "")) continue;
    const owner = String(wallet.owner ?? "");
    const enterprise = owner.startsWith("enterprise:") ? owner.slice("enterprise:".length) : undefined;
    const seatedEntity = territories.find((territory) => territory.id === enterprise)?.entity;
    const party = owner === "org" ? { entity }
      : owner === "founder" ? { entity: "founder" }
        : enterprise !== undefined ? { enterprise, ...(seatedEntity ? { entity: seatedEntity } : {}) }
          : undefined;
    if (party !== undefined) accounts.set(wallet.address.toLowerCase(), Object.freeze(party));
  }
  return accounts;
}

/**
 * The identifier namespaces only the house mints: its micro-enterprises (`urn:ame:`) and the actors
 * it constitutes for its harnesses, services and teams (`actor:`, eavt's one Actor law). A party
 * named in one is a member of the Group; an outside party the house constitutes is registered as an
 * account of its own entity, which the resolver reads first.
 */
export const HOUSE_NAMESPACES = Object.freeze(["urn:ame:", "actor:"]);

/** The Group's party resolver: its seated enterprises' territories, its registered wallets and the namespaces it mints. */
export function groupPartyOf({ enterprises = [], walletRegistry, entity = GROUP_ENTITY } = {}) {
  const territories = territoriesOf(enterprises);
  return partyResolverOf({
    territories,
    accounts: walletAccountsOf(walletRegistry, { entity, territories }),
    namespaces: HOUSE_NAMESPACES.map((prefix) => ({ prefix, party: { entity } })),
  });
}

/**
 * The inference market's measured resources (`{resource, unit, amount: {numerator, denominator}}`)
 * as organizing's resource records, consumed through `carrier`: whole quantities only, since a
 * resource record counts units; a fractional reading is left out rather than rounded.
 */
export function resourcesOfMeasured(measured = [], carrier) {
  const records = [];
  for (const entry of Array.isArray(measured) ? measured : []) {
    const amount = entry?.amount;
    const whole = typeof amount === "string" || typeof amount === "number" ? String(amount)
      : amount?.denominator === "1" || amount?.denominator === 1 ? String(amount.numerator) : undefined;
    if (!text(entry?.resource) || !text(entry?.unit) || whole === undefined || !/^(?:0|[1-9]\d*)$/u.test(whole)) continue;
    records.push({ resource: entry.resource, unit: entry.unit, amount: whole, ...(text(carrier) ? { carrier } : {}) });
  }
  return records;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFile(path, "utf8").then((body) => body.split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }));
}

/**
 * The outcomes the inference market's receivers judged (computer-inference-engine
 * expected-resolution pricing, `receiver-outcome` rows): accepted or refused deliveries keyed by
 * the model that carried them; a void or retraction voids the outcome it withdraws, and a
 * retraction also tells the refusal it became. A row that names no judge or lot is not an outcome
 * and is counted, not guessed.
 */
export function inferenceMarketOutcomesOf({ observations = [], deliveries = [] } = {}) {
  const deliveryOf = new Map(deliveries.filter((delivery) => delivery?.kind === "inference-delivery").map((delivery) => [delivery.id, delivery]));
  const fieldsOf = (row) => {
    const delivery = deliveryOf.get(row.delivery);
    const carrier = delivery?.configuration?.model ?? row.configurationIdentity ?? delivery?.configurationIdentity;
    const resources = resourcesOfMeasured(Array.isArray(row.resources) ? row.resources : delivery?.resources, carrier);
    return {
      source: "inference-market", lot: row.workLot, delivery: row.delivery ?? row.receipt, provider: row.provider, judge: row.receiver,
      ...(text(carrier) ? { carrier } : {}), taskClass: row.taskClass,
      market: { provider: row.provider, offer: row.selectedOffer, taskClass: row.taskClass, receipt: row.receipt, ...(text(row.configurationIdentity) ? { configuration: row.configurationIdentity } : {}) },
      ...(resources.length === 0 ? {} : { resources }),
    };
  };
  const told = new Map();
  const outcomes = [];
  let skipped = 0;
  const tell = (input) => {
    try { const outcome = outcomeOf(input); outcomes.push(outcome); return outcome; }
    catch {
      // Resources in a shape the outcome refuses are left off rather than losing the judgment.
      if (input.resources !== undefined) { const { resources, ...rest } = input; return tell(rest); }
      skipped += 1;
      return undefined;
    }
  };
  for (const row of observations) {
    if (row?.kind !== "receiver-outcome" || !["accepted", "refused"].includes(row.outcome)) continue;
    const outcome = tell({ ...fieldsOf(row), verdict: row.outcome === "accepted" ? "accepted" : "rejected", at: row.observedAt, evidence: [row.evidence, `inference-observation:${row.id}`] });
    if (outcome !== undefined) told.set(row.id, { row, outcome });
  }
  for (const row of observations) {
    if (row?.kind !== "receiver-outcome-void" && row?.kind !== "receiver-outcome-retraction") continue;
    const original = told.get(row.originalOutcome);
    if (original === undefined) continue;
    const evidence = [row.evidence ?? `inference-observation:${row.id}`, `inference-observation:${row.id}`];
    tell({ ...fieldsOf(original.row), verdict: "voided", voids: original.outcome.id, at: row.observedAt, evidence });
    if (row.kind === "receiver-outcome-retraction") tell({ ...fieldsOf(original.row), verdict: "rejected", at: row.observedAt, evidence });
  }
  return Object.freeze({ outcomes: Object.freeze(outcomes), skipped });
}

/** The node's inference pricing root: the deployment's, else beside its web data. */
export { pricingRootOf };

/** Tell the inference market's receiver judgments into the outcome journal; returns what was new. */
export async function tellInferenceMarketOutcomes(journal, pricingRoot) {
  if (!text(pricingRoot)) return Object.freeze({ told: 0, skipped: 0, read: 0 });
  const [observations, deliveries] = await Promise.all([readJsonl(join(pricingRoot, "observations.jsonl")), readJsonl(join(pricingRoot, "deliveries.jsonl"))]);
  const { outcomes, skipped } = inferenceMarketOutcomesOf({ observations, deliveries });
  return Object.freeze({ told: journal.record(outcomes), skipped, read: outcomes.length });
}

/** The section the Koios line delivers from: its articles are that section's work. */
export const KOIOS_SECTION = "section:lib/emsenn/services/561-group/services/public-services-section/services/public-media-services-section/services/public-news-media-services-section/services/koios-news-services-section";
/** The editor that judges Koios editions: the independent editorial assessment. */
export const KOIOS_EDITOR = "urn:ame:independent-editorial-assessment";
const EDITOR_VERDICTS = Object.freeze({ accepted: "accepted", returned: "rejected", refused: "rejected" });

/**
 * The outcomes the Koios editor judged: every accept, return and refusal in an edition's history
 * is the editor's judgment of that manuscript (the edition's candidate), carried by the writer
 * model the edition records. The latest judgment of a manuscript stands (`standingOutcomes`). A
 * return names the layer that failed. The edition records no market coordinate for its draft, so
 * these backfilled outcomes teach staffing and the readout; the line itself tells each verdict at the source with the market coordinate (koios `news-line/outcomes.mjs`), which teaches routing.
 */
export function koiosEditorOutcomesOf(editions = []) {
  const outcomes = [];
  let skipped = 0;
  for (const edition of editions) {
    for (const event of edition?.history ?? []) {
      const verdict = EDITOR_VERDICTS[event?.state];
      if (verdict === undefined) continue;
      try {
        outcomes.push(outcomeOf({
          source: "editor", lot: edition.storyId ?? edition.candidateId, delivery: edition.candidateId,
          provider: KOIOS_SECTION, judge: KOIOS_EDITOR, verdict, at: event.at,
          evidence: [`koios-edition:${edition.candidateId}`, `koios-edition-${event.state}:${event.at}`, ...(verdict === "accepted" && text(edition.receiptPath) ? [`koios-receipt:${edition.receiptPath.split("/").at(-1)}`] : [])],
          ...(text(edition.model) ? { carrier: edition.model } : {}), taskClass: "koios/news-edition",
          // Only a judgment of the writer's prose teaches routing: a return at the sources or assignment layer faults the
          // order's evidence, and a refusal (a story gone stale, an assessment never completed) judged no prose at all.
          ...(edition.market && (verdict === "accepted" || (event.state === "returned" && !["sources", "assignment"].includes(edition.failureLayer))) ? { market: edition.market } : {}),
          ...(verdict === "rejected" ? { reason: [event.reason ?? edition.reason, edition.failureLayer].filter(text).join(": ") || event.state } : {}),
        }));
      } catch { skipped += 1; }
    }
  }
  return Object.freeze({ outcomes: Object.freeze(outcomes), skipped });
}

/** The Koios line's state root: the deployment's, else beside the node's state. */
export const koiosLineRootOf = (environment) => environment.KOIOS_LINE_ROOT
  ?? (text(environment.METROPLAT_WEB_DATA_DIR) ? join(dirname(dirname(environment.METROPLAT_WEB_DATA_DIR)), "news-property", "Koios.News", "line") : undefined);

/** Tell the Koios editor's judgments into the outcome journal; returns what was new. */
export async function tellKoiosEditorOutcomes(journal, lineRoot) {
  const directory = text(lineRoot) ? join(lineRoot, "editions") : undefined;
  if (directory === undefined || !existsSync(directory)) return Object.freeze({ told: 0, skipped: 0, read: 0 });
  const editions = [];
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".json"))) {
    try { editions.push(JSON.parse(await readFile(join(directory, name), "utf8"))); } catch { /* A damaged edition is no judgment. */ }
  }
  const { outcomes, skipped } = koiosEditorOutcomesOf(editions);
  // The line tells each verdict at the source, with its draft's market coordinate; a verdict the journal
  // already holds (same manuscript, verdict and instant) is not told again as a market-less twin.
  const held = new Set(journal.read().filter((outcome) => outcome.source === "editor").map((outcome) => `${outcome.delivery}\u0000${outcome.verdict}\u0000${outcome.at}`));
  const fresh = outcomes.filter((outcome) => !held.has(`${outcome.delivery}\u0000${outcome.verdict}\u0000${outcome.at}`));
  return Object.freeze({ told: journal.record(fresh), skipped, read: outcomes.length });
}


async function atomicWrite(path, body) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  return path;
}

/** The Group's book of judged deliveries, in node state beside the readouts, where ledger-readings consolidates it. */
export const outcomeBookPathOf = (webDataDir) => entityOutcomeBookOf(GROUP_ENTITY, { environment: { METROPLAT_WEB_DATA_DIR: webDataDir } });

/**
 * The deliveries an authored ledger already books: each transaction's `source_id`, less those a
 * later entry hands to the book of judged deliveries (`reverses` with `handed_to`), which this
 * book then books itself.
 */
export async function bookedSourcesOf(ledgerPath) {
  if (!text(ledgerPath) || !existsSync(ledgerPath)) return new Set();
  const ledger = await readFile(ledgerPath, "utf8");
  const handed = new Set(ledger.split(/\n(?=\d{4}-\d\d-\d\d )/u).filter((block) => /^\s+handed_to: "/mu.test(block))
    .flatMap((block) => [/^\s+reverses: "([^"]+)"/mu.exec(block)?.[1]].filter(Boolean)));
  return new Set([...ledger.matchAll(/^\s+source_id:\s+"([^"]+)"\s*$/gmu)].map((match) => match[1]).filter((id) => !handed.has(id)));
}

/**
 * Rewrite the Group's derived book whole from the outcomes, leaving to the authored ledger
 * (`ledgerPath`) every delivery it already books.
 */
async function writeReceivedOutcomeBook(webDataDir, outcomes, partyOf, { ledgerPath } = {}) {
  const booked = await bookedSourcesOf(ledgerPath);
  const body = outcomeBookText(outcomes, { partyOf, booked, title: "561 Group LLC's book of judged deliveries" });
  const path = await atomicWrite(outcomeBookPathOf(webDataDir), body);
  return Object.freeze({ path, bookSha256: bookSha256Of(body) });
}

export async function writeOutcomeBook(webDataDir, outcomes, partyOf, options = {}) {
  return (await writeReceivedOutcomeBook(webDataDir, outcomes, partyOf, options)).path;
}

/**
 * The economy the board carries, as the CFO reads it beside the books (organizing/enterprise
 * `economyOf`): crossings by stage, multilateral netting of the members' credit lines, each pair's
 * flow with its tally credit, and the obstructions that keep the books from gluing, counted by kind.
 */
export function economySummaryOf(economy) {
  const obstructions = {};
  for (const obstruction of economy.obstructions) obstructions[obstruction.kind] = (obstructions[obstruction.kind] ?? 0) + 1;
  return Object.freeze({
    kind: economy.kind, at: economy.at, crossings: economy.crossings, readings: economy.readings, netting: economy.netting,
    flows: Object.freeze(economy.flows.filter((flow) => Object.keys(flow.stages).some((stage) => stage !== "lapsed"))
      .map((flow) => Object.freeze({ provider: flow.provider, requester: flow.requester, seam: flow.seam, stages: flow.stages, credit: flow.credit }))),
    market: Object.freeze({ offers: economy.market.length }),
    obstructions: Object.freeze(obstructions),
  });
}

/**
 * Produce the acceptance readout of a week from records alone, with the economy the board carries
 * (`economySummaryOf`): tell the inference market's
 * receiver judgments, the work arena's assays and the Koios editor's judgments into the outcome journal, read every outcome, project the Group's derived book,
 * and read the week (`period`: the last complete ISO week by default, or `current` for the week
 * to date). Writes `<webData>/records/acceptance/<week>[-to-date]-acceptance-readout.json`.
 */
export async function produceAcceptanceReadout({ environment = process.env, now = () => new Date().toISOString(), period = "previous", enterprises = [], walletRegistry } = {}) {
  const dataRoot = environment.METROPLAT_DATA_ROOT;
  const webData = environment.METROPLAT_WEB_DATA_DIR;
  if (!text(dataRoot) || !text(webData)) throw new TypeError("acceptance readout requires METROPLAT_DATA_ROOT and METROPLAT_WEB_DATA_DIR");
  const asOf = now();
  const journal = outcomeJournal(dataRoot);
  const inference = await tellInferenceMarketOutcomes(journal, pricingRootOf(environment));
  const editor = await tellKoiosEditorOutcomes(journal, koiosLineRootOf(environment));
  const territories = territoriesOf(enterprises);
  const board = workArenaBoardAt(dataRoot, asOf, { territories });
  const judged = arenaOutcomesOf(board);
  const arena = Object.freeze({ told: journal.record(judged), read: judged.length });
  const economy = economySummaryOf(economyOf(board, { at: asOf, territories }));
  const outcomes = journal.read();
  const partyOf = groupPartyOf({ enterprises, walletRegistry });
  const { path: bookPath, bookSha256 } = await writeReceivedOutcomeBook(webData, outcomes, partyOf, { ledgerPath: environment.METROPLAT_LEDGER_JOURNAL });
  // Staffing reads the journal folded once here, never the journal itself: received work is left
  // out, since the work queue already counts it.
  const standingPath = await atomicWrite(outcomeStandingIndexOf({ environment: { METROPLAT_WEB_DATA_DIR: webData } }), `${JSON.stringify(standingIndexOf(
    standingOf(outcomes.filter((outcome) => outcome.source !== "work-discharge")), { at: asOf, digest: outcomesDigestOf(outcomes), excluded: ["work-discharge"] }), null, 2)}\n`);
  // Each micro-enterprise's value-added statement reads what its users paid, folded here.
  const settlementsPath = await atomicWrite(outcomeSettlementsIndexOf({ environment: { METROPLAT_WEB_DATA_DIR: webData } }), `${JSON.stringify(judgedSettlementsIndexOf(outcomes, { partyOf, at: asOf, digest: outcomesDigestOf(outcomes) }), null, 2)}\n`);
  // Routing reads the other registers' judgments of inference deliveries folded here, never the journal.
  const marketPath = await atomicWrite(outcomeMarketIndexOf({ environment: { METROPLAT_WEB_DATA_DIR: webData } }), `${JSON.stringify(marketJudgmentsIndexOf(outcomes, { at: asOf, digest: outcomesDigestOf(outcomes) }), null, 2)}\n`);
  const week = isoWeekOf(period === "current" ? asOf : new Date(Date.parse(asOf) - 7 * DAY_MS).toISOString());
  const to = period === "current" ? asOf : week.to;
  const readout = Object.freeze({
    type: "GroupAcceptanceReadout", version: 1, asOf, week: week.week, complete: period !== "current",
    ...acceptanceReadoutOf(outcomes, { from: week.from, to, partyOf, priceOf: resourcePricesAt(resourcePricesIndexOf({ environment: { METROPLAT_WEB_DATA_DIR: webData } })) }),
    journal: Object.freeze({ excluded: Object.freeze(["x402-settlement"]), outcomes: outcomes.length, digest: outcomesDigestOf(outcomes), bySource: Object.freeze(Object.fromEntries([...new Set(outcomes.map((outcome) => outcome.source))].sort().map((source) => [source, outcomes.filter((outcome) => outcome.source === source).length]))) }),
    told: Object.freeze({ workArena: arena, inferenceMarket: inference, koiosEditor: editor }),
    economy,
    // Each face's reach, from the dated readings the personas' turns append to their records alone.
    reach: reachReadoutOf(text(personasRootOf(environment)) ? readReachRecords(personasRootOf(environment)) : [], { from: week.from, to }),
    book: bookPath,
    bookSha256,
    standing: standingPath,
    marketJudgments: marketPath,
    judgedSettlements: settlementsPath,
  });
  const path = await atomicWrite(join(webData, "records", "acceptance", `${week.week}${period === "current" ? "-to-date" : ""}-acceptance-readout.json`), `${JSON.stringify(readout, null, 2)}\n`);
  return Object.freeze({ path, readout });
}
