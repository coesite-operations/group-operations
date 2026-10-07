// Observe the provider accounts configured on the author node.
// Only identifiers and observations are returned; credential values never enter the record.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = (() => {
  let dir = here;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("repository root unavailable");
})();
const cloudflareModule = join(root, "lib/emsenn/services/561-group/services/engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/cloud-services-section/services/cloudflare-services-section/scripts/derive-cloudflare-account-inventory.mjs");

// A CLI is found on PATH, else in the XDG user executable directory ($HOME/.local/bin), which a
// user service manager's PATH does not carry: where the node runs must not decide what it observes.
function executable(name) {
  const dirs = [...(process.env.PATH ?? "").split(":").filter(Boolean), join(process.env.HOME ?? "", ".local/bin")];
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? name;
}

function command(bin, args) {
  const result = spawnSync(executable(bin), args, { encoding: "utf8", timeout: 45_000, env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" } });
  if (result.status !== 0 || result.error) return { status: "unavailable", reason: result.error?.code ?? `exit-${result.status}` };
  return { status: "observed", text: result.stdout.trim() };
}

function jsonCommand(bin, args) {
  const result = command(bin, args);
  if (result.status !== "observed") return result;
  if (result.text === "") return { status: "observed", value: [] }; // OCI emits no body for empty lists.
  try { return { status: "observed", value: JSON.parse(result.text) }; }
  catch { return { status: "unavailable", reason: "invalid-json" }; }
}

function gcloud(args) { return jsonCommand("gcloud", [...args, "--format=json", "--quiet"]); }
function oci(profile, args) { return jsonCommand("oci", [...args, "--profile", profile, "--output", "json"]); }
function value(reading, fallback = []) { return reading.status === "observed" ? reading.value : fallback; }

function ociProfiles(configPath) {
  if (!existsSync(configPath)) return [];
  const names = [...readFileSync(configPath, "utf8").matchAll(/^\[([^\]]+)\]/gmu)].map((match) => match[1]);
  return names.filter((name) => name !== "DEFAULT");
}

function ociField(configPath, profile, key) {
  const section = readFileSync(configPath, "utf8").split(/^\[([^\]]+)\]\s*$/gmu);
  const index = section.indexOf(profile);
  if (index < 0) return undefined;
  return section[index + 1].match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "mu"))?.[1]?.trim();
}

export async function observeComputeResources() {
  const observedAt = new Date().toISOString();
  const googleAccounts = gcloud(["auth", "list"]);
  const projectsReading = gcloud(["projects", "list"]);
  const projects = value(projectsReading).map((project) => {
    const id = project.projectId;
    const billing = gcloud(["billing", "projects", "describe", id]);
    const services = gcloud(["services", "list", "--enabled", `--project=${id}`]);
    const enabled = value(services).map((entry) => entry.config?.name).filter(Boolean);
    const run = enabled.includes("run.googleapis.com")
      ? gcloud(["run", "services", "list", `--project=${id}`, "--platform=managed", "--region=us-central1"])
      : { status: "not-enabled" };
    const compute = enabled.includes("compute.googleapis.com") && billing.value?.billingEnabled !== false
      ? gcloud(["compute", "instances", "list", `--project=${id}`])
      : { status: "not-enabled" };
    return {
      projectId: id, name: project.name, lifecycle: project.lifecycleState,
      billing: billing.status === "observed" ? { status: "observed", enabled: billing.value.billingEnabled === true } : billing,
      enabledComputeServices: enabled.filter((name) => /^(compute|run|cloudfunctions|cloudbuild|storage|artifactregistry)\.googleapis\.com$/u.test(name)),
      cloudRunUsCentral1: run.status === "observed" ? { status: "observed", services: value(run).map((service) => {
        const ready = service.status?.conditions?.find((condition) => condition.type === "Ready");
        return { name: service.metadata?.name, url: service.status?.url, ready: ready?.status,
          readyReason: ready?.reason, latestCreatedRevision: service.status?.latestCreatedRevisionName,
          latestReadyRevision: service.status?.latestReadyRevisionName,
          traffic: (service.status?.traffic ?? []).map((target) => ({ revision: target.revisionName, percent: target.percent ?? 0, tag: target.tag })) };
      }) } : run,
      computeInstances: billing.value?.billingEnabled === false
        ? { status: "unavailable", reason: "billing-disabled; Compute Engine list cannot establish an empty inventory" }
        : compute.status === "observed" ? { status: "observed", instances: value(compute).map((instance) => ({ name: instance.name, zone: instance.zone?.split("/").at(-1), status: instance.status, machineType: instance.machineType?.split("/").at(-1) })) } : compute,
    };
  });

  const ociConfig = join(process.env.HOME ?? "", ".oci/config");
  const profiles = ociProfiles(ociConfig);
  const profile = profiles.find((name) => name.endsWith("_API_KEY")) ?? profiles[0];
  let oracle = { status: "credential-unavailable", profiles };
  if (profile) {
    const tenancy = ociField(ociConfig, profile, "tenancy");
    const region = ociField(ociConfig, profile, "region");
    const tenancyReading = tenancy ? oci(profile, ["iam", "tenancy", "get", "--tenancy-id", tenancy]) : { status: "unavailable", reason: "tenancy-not-configured" };
    const regions = tenancy ? oci(profile, ["iam", "region-subscription", "list", "--tenancy-id", tenancy]) : { status: "unavailable", reason: "tenancy-not-configured" };
    const compartments = tenancy ? oci(profile, ["iam", "compartment", "list", "--compartment-id", tenancy, "--compartment-id-in-subtree", "true", "--all"]) : { status: "unavailable", reason: "tenancy-not-configured" };
    const compartmentIds = [tenancy, ...(compartments.value?.data ?? []).map((item) => item.id)].filter(Boolean);
    const instances = [];
    for (const id of compartmentIds) {
      const reading = oci(profile, ["compute", "instance", "list", "--compartment-id", id, "--all"]);
      instances.push({ compartmentId: id, status: reading.status, ...(reading.status === "observed" ? { items: (reading.value.data ?? reading.value).map((item) => ({ name: item["display-name"], state: item["lifecycle-state"], shape: item.shape, availabilityDomain: item["availability-domain"] })) } : { reason: reading.reason }) });
    }
    oracle = { status: tenancyReading.status, tenancyName: tenancyReading.value?.data?.name, configuredRegion: region, profiles, subscribedRegions: (regions.value?.data ?? []).map((item) => item["region-name"]), compartments: (compartments.value?.data ?? []).map((item) => ({ name: item.name, id: item.id })), instances };
  }

  let cloudflare = { status: "credential-unavailable" };
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    try {
      const { deriveCloudflareAccountInventory } = await import(pathToFileURL(cloudflareModule).href);
      const reading = await deriveCloudflareAccountInventory({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, tokenEnvironmentVariable: "CLOUDFLARE_API_TOKEN" });
      cloudflare = reading.type === "CloudflareAccountInventory" ? {
        status: "observed", accountId: reading.accountId, counts: reading.counts,
        zones: reading.zones.map((zone) => ({ name: zone.name, status: zone.status,
          destinations: zone.records.filter((record) => ["A", "AAAA", "CNAME"].includes(record.type)).map((record) => ({ type: record.type, name: record.name, content: record.content, proxied: record.proxied })) })),
        workers: reading.workers.map((worker) => ({ name: worker.id, modifiedOn: worker.modifiedOn })),
        customDomains: reading.customDomains.map((domain) => ({ hostname: domain.hostname, service: domain.service, zoneName: domain.zoneName })),
      } : { status: "unavailable", reason: reading.code };
    } catch {
      cloudflare = { status: "unavailable", reason: "reader-failed" };
    }
  }

  const ssh = command("ssh", ["-G", "cold-red-gate"]);
  const hostname = ssh.status === "observed" ? ssh.text.match(/^hostname (.+)$/mu)?.[1] : undefined;
  return {
    kind: "compute-resource-observation", observedAt,
    coverage: "Provider APIs and configured CLI identities observed from bare-cedar-fog. Cloud Run is queried in us-central1; other regions and account principals may hold more resources. DNS is routing evidence, not host liveness. Billing disabled is not a free-capacity guarantee.",
    placement: "For new workloads, assess cloud accounts against the workload, quotas, billing, and service health. The personal laptop and cold-red-gate are excluded from new placement by the operator's direction.",
    credentials: [
      { provider: "google-cloud", locator: "~/.config/gcloud", configured: existsSync(join(process.env.HOME ?? "", ".config/gcloud/credentials.db")), accounts: value(googleAccounts).map((account) => ({ name: account.account, status: account.status })), secretValuesRecorded: false },
      { provider: "oracle-cloud", locator: "~/.oci/config", profiles: profiles.map((name) => ({ name, keyFile: ociField(ociConfig, name, "key_file") })), configured: profiles.length > 0, secretValuesRecorded: false },
      { provider: "cloudflare", locator: "process environment", environmentKeys: Object.keys(process.env).filter((name) => /^CLOUDFLARE_/u.test(name)).sort(), configured: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN), secretValuesRecorded: false },
      { provider: "ssh", locator: "~/.ssh/config: cold-red-gate", configured: Boolean(hostname), secretValuesRecorded: false },
    ],
    machines: [{ name: "bare-cedar-fog", evidence: "repository README", role: "personal laptop", newPlacement: "excluded by operator direction" }, ...(hostname ? [{ name: "cold-red-gate", hostname, evidence: "SSH configuration", role: "VPS; operator reports it is overloaded", newPlacement: "excluded by operator direction" }] : [])],
    googleCloud: { status: projectsReading.status, projects }, oracleCloud: oracle, cloudflare,
  };
}
