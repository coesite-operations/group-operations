import { readdirSync } from "node:fs";
import { join } from "node:path";
import { arrivalLogPathForDate, readArrivalLogProjection } from "@red-cup-engineering/computer-system-engine/rpc/arrival-store";
import { readFileUtf8 } from "@red-cup-engineering/computer-system-engine/filesystem";
import { deliverFromEnvironment } from "@red-cup-engineering/activitypub-services-section/deliver";
import { projectSignCellEvidenceActivity, senActivityObjectBytes } from "@red-cup-engineering/activitypub-services-section/sen-activity";

const EVIDENCE_TYPE = "org.semioverse.activitypub.signcell-evidence.create.v1";
const cache = new Map();

function directories(root, pattern) {
  try { return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && pattern.test(entry.name)).map((entry) => entry.name); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
}

function arrivalDates(root) {
  const journals = join(root, "data", "journals");
  const dates = [];
  for (const year of directories(journals, /^\d{4}$/u))
    for (const month of directories(join(journals, year), /^(?:0[1-9]|1[0-2])$/u))
      for (const day of directories(join(journals, year, month), /^(?:0[1-9]|[12]\d|3[01])$/u))
        dates.push(`${year}-${month}-${day}`);
  return dates.sort().reverse();
}

/** Read an addressed, admitted observation by its author and kind. */
export function currentPeerEvidence({ config, authorActor, objectKind, validValue }) {
  const recipientIdentifier = config.activityPub?.instanceActor?.identifier;
  if (recipientIdentifier === undefined) return null;
  const localOrigin = new URL(config.publicBaseUrl).origin;
  const recipient = new URL(`/actors/${recipientIdentifier}`, localOrigin).href;
  const cacheKey = `${config.metroplatDataRoot}|${authorActor}|${recipient}|${objectKind}`;
  const cached = cache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.value;
  for (const date of arrivalDates(config.metroplatDataRoot)) {
    const projection = readArrivalLogProjection(arrivalLogPathForDate(config.metroplatDataRoot, date), { readFileUtf8 });
    const values = projection.entries.flatMap((entry) => {
      const event = entry.packet?.presentation;
      return entry.obstructions.length === 0 && event?.source === authorActor && event.subject === recipient
        && event.type === EVIDENCE_TYPE && event.data?.profile === "org.semioverse.activitypub.signcell-evidence.v1"
        && event.data.objectKind === objectKind && validValue(event.data.value)
        ? [event.data.value] : [];
    });
    if (values.length) {
      const value = values.sort((left, right) => right.asOf.localeCompare(left.asOf))[0];
      cache.set(cacheKey, { value, expiresAt: Date.now() + 30_000 });
      return value;
    }
  }
  cache.set(cacheKey, { value: null, expiresAt: Date.now() + 30_000 });
  return null;
}

/** Send one dated result to the explicitly configured peer, using this instance actor. */
export async function sendPeerEvidence({ environment, peerActor, peerInbox, objectKind, value }) {
  const origin = environment.ACTIVITYPUB_ORIGIN;
  const identifier = environment.ACTIVITYPUB_INSTANCE_ACTOR_IDENTIFIER;
  const stateDir = environment.METROPLAT_WEB_STATE_DIR;
  if (!origin || !identifier || !stateDir) throw new TypeError("Peer evidence requires the local instance actor and state directory");
  const activity = projectSignCellEvidenceActivity({
    origin, identifier, recipient: peerActor, eventTime: value.asOf,
    objectBytes: senActivityObjectBytes({ objectKind, value }),
  });
  return deliverFromEnvironment(activity, {
    origin, identifier, recipient: peerActor,
    inbox: peerInbox ?? `${peerActor.replace(/\/$/u, "")}/inbox`,
    keyPath: join(stateDir, "activitypub-keys", `${identifier}.json`),
  });
}
