import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The jobs this instance declares, read from trusted factory context, never request input. */
export function nodeJobDeploymentSelectionOf({ environment = {}, processConfig = {}, instanceIdentity } = {}) {
  const instancePath = environment?.METROPLAT_INSTANCE ?? processConfig?.instance;
  if (typeof instancePath !== "string" || instancePath === "" || typeof instanceIdentity?.id !== "string" || instanceIdentity.id === ""
    || typeof instanceIdentity.title !== "string" || instanceIdentity.title.trim() === "") {
    throw new TypeError("node-job: an installed instance and its admitted identity are required");
  }
  if (environment?.METROPLAT_INSTANCE !== undefined && processConfig?.instance !== undefined
    && resolve(environment.METROPLAT_INSTANCE) !== resolve(processConfig.instance)) {
    throw new TypeError("node-job: the installed instance differs from process options");
  }
  const instance = JSON.parse(readFileSync(resolve(instancePath), "utf8"));
  // MetroPlat has already validated this identity. Profiles cannot declare scheduleSources;
  // only the installed local manifest binds this instance's deployment selections.
  if (instance?.version !== 1 || instance.instanceOf !== "@red-cup-engineering/metroplat"
    || ["id", "title", "origin"].some((key) => instance.identity?.[key] !== instanceIdentity[key])) {
    throw new TypeError("node-job: the installed manifest differs from its admitted instance identity");
  }
  if (!Array.isArray(instance.scheduleSources)) throw new TypeError("node-job: this instance declares no job schedule sources");
  const selections = new Set();
  for (const source of instance.scheduleSources) {
    if (source === null || typeof source !== "object" || Array.isArray(source)
      || typeof source.module !== "string" || typeof source.export !== "string"
      || (source.configuration !== undefined && (source.configuration === null || typeof source.configuration !== "object" || Array.isArray(source.configuration)))) {
      throw new TypeError("node-job: an installed schedule source must name a package export and object configuration");
    }
    if (source?.module !== "@561-group/group-operations/node-job-operation" || source.export !== "nodeJobSchedules") continue;
    const deployment = source.configuration?.deployment;
    if (selections.has(deployment)) throw new TypeError(`node-job: this instance repeats deployment ${JSON.stringify(deployment)}`);
    if (typeof deployment !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(deployment)) throw new TypeError("node-job: an installed job source must select a valid deployment");
    selections.add(deployment);
  }
  if (selections.size === 0) throw new TypeError("node-job: this instance declares no job deployments");
  return Object.freeze([...selections]);
}

