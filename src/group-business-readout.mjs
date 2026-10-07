import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { htmlRepr, jsonRepr } from "@red-cup-engineering/http-services-section/representation";
import { readingHtml } from "@red-cup-engineering/metroplat-operations-console/control-plane";
import { guardOperators } from "@red-cup-engineering/metroplat-operations-console/people";
import { currentPeerEvidence, sendPeerEvidence } from "./peer-evidence.mjs";

const OBJECT_KIND = "561-group.business-readout.v1";
const RECORD_DIR = "group-business";
const valid = (value) => value?.type === "GroupBusinessReadout"
  && typeof value.asOf === "string" && Number.isFinite(Date.parse(value.asOf))
  && Array.isArray(value.enterprises)
  && (value.board === undefined || (value.board?.kind === "enterprise.erp-ics-crm-board" && Array.isArray(value.board.enterprises)));

function currentLocal(dataDir) {
  const directory = join(dataDir, "records", RECORD_DIR);
  let names;
  try { names = readdirSync(directory); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  for (const name of names.filter((item) => /^\d{4}-\d{2}-\d{2}.*-group-business-readout\.json$/u.test(item)).sort().reverse()) {
    try {
      const value = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (valid(value)) return value;
    } catch { /* A damaged record does not hide an earlier valid one. */ }
  }
  return null;
}

export function currentGroupBusinessReadout({ config, authorActor }) {
  if (new URL(authorActor).origin === new URL(config.publicBaseUrl).origin) return currentLocal(config.dataDir);
  return currentPeerEvidence({ config, authorActor, objectKind: OBJECT_KIND, validValue: valid });
}

export function groupBusinessReadoutOperation({ readEnterprises, readBoard, environment = process.env, clock = () => new Date().toISOString() }) {
  return operation({
    verb: "group-business-readout-produce",
    summary: "Record the Group's enterprise reading and deliver it to its MetroPlat peer.",
    reads: ["agency/enterprises", "agency/contracts", "enterprise/records"],
    writes: ["group-business-readout"],
    effects: { class: "external", replay: "coordinated", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: async () => {
      const asOf = clock();
      if (!Number.isFinite(Date.parse(asOf))) throw new TypeError("Business readout requires a dated clock");
      const directory = join(environment.METROPLAT_WEB_DATA_DIR, "records", RECORD_DIR);
      const path = join(directory, `${asOf.replace(/[:.]/gu, "-")}-group-business-readout.json`);
      await mkdir(directory, { recursive: true });
      let readout;
      try { readout = JSON.parse(await readFile(path, "utf8")); }
      catch (error) {
        if (error?.code !== "ENOENT") throw error;
        readout = {
          type: "GroupBusinessReadout",
          asOf,
          enterprises: await readEnterprises(),
          ...(readBoard === undefined ? {} : { board: await readBoard() }),
        };
        if (!valid(readout)) throw new TypeError("Enterprise reading is invalid");
        await writeFile(path, JSON.stringify(readout) + "\n", { flag: "wx" });
      }
      const peerActor = environment.GROUP_PEER_ACTOR;
      const delivery = peerActor === undefined ? null : await sendPeerEvidence({
        environment, peerActor, peerInbox: environment.GROUP_PEER_INBOX,
        objectKind: OBJECT_KIND, value: readout,
      });
      return { readout, path, delivery };
    },
  });
}

export function groupBusinessReadoutView({ config, configuration = {} }) {
  const authorActor = configuration.authorActor;
  if (typeof authorActor !== "string" || new URL(authorActor).protocol !== "https:") throw new TypeError("Business readout requires its author actor");
  const navigation = Object.assign([
    { href: "/play", label: "Play" },
    { href: "/tasks/view", label: "Work" },
    { href: "/books/group-readout", label: "Daily readout" },
    { href: "/businesses/summary", label: "Businesses" },
  ], { title: config.instance.title });
  const read = () => currentGroupBusinessReadout({ config, authorActor });
  const resources = [
    { id: "group-business.readout-view", match: "/businesses/summary", methods: ["GET"], produces: ["text/html"],
      handler: () => {
        const result = read();
        return result === null
          ? htmlRepr(readingHtml(navigation, { error: "business_readout_unavailable" }, "Businesses unavailable", "/businesses/summary"), { status: 503, cacheControl: { noStore: true } })
          : htmlRepr(readingHtml(navigation, result, "Group businesses", "/businesses/summary"), { cacheControl: { noStore: true } });
      } },
    { id: "group-business.readout", match: "/businesses/summary.json", methods: ["GET"], produces: ["application/json"],
      handler: () => {
        const result = read();
        return result === null
          ? jsonRepr({ error: "business_readout_unavailable" }, { status: 503, cacheControl: { noStore: true } })
          : jsonRepr(result, { cacheControl: { noStore: true } });
      } },
  ];
  return { applications: [guardOperators({ resources }, () => true, {
    stateDir: config.stateDir, allowedEmail: config.allowedEmail, navigation, navigationTitle: navigation.title,
  })] };
}
