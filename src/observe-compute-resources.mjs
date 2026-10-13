// Observe the provider accounts configured on the author node.
// Only identifiers and observations are returned; credential values never enter the record.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// This is a standalone Coesite package. The owning Cloudflare Engineering
// package exports the provider reader; an old monorepo-relative source path
// is neither a released dependency nor a valid installation contract.

// A CLI is found on PATH, else in the XDG user executable directory ($HOME/.local/bin), which a
// user service manager's PATH does not carry: where the node runs must not decide what it observes.
function executable(name) {
  const dirs = [...(process.env.PATH ?? "").split(":").filter(Boolean), join(process.env.HOME ?? "", ".local/bin")];
  return dirs.map((dir) => join(dir, name)).find((path) => existsSync(path)) ?? name;
}

async function command(bin, args) {
  // Provider probes may wait on network or CLI credential access. Never block
  // the author's HTTP/ActivityPub event loop with spawnSync.
  try {
    const { stdout } = await execFileAsync(executable(bin), args, {
      encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, CLOUDSDK_CORE_DISABLE_PROMPTS: "1" },
    });
    return { status: "observed", text: stdout.trim() };
  } catch (error) {
    // stderr often contains provider account material; retain only error class.
    const reason = error?.code === "ENOENT" ? "executable-unavailable"
      : error?.killed ? "provider-timeout" : "provider-command-failed";
    return { status: "unavailable", reason };
  }
}

async function jsonCommand(bin, args) {
  const result = await command(bin, args);
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
  return names;
}

function ociField(configPath, profile, key) {
  const section = readFileSync(configPath, "utf8").split(/^\[([^\]]+)\]\s*$/gmu);
  const index = section.indexOf(profile);
  if (index < 0) return undefined;
  return section[index + 1].match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "mu"))?.[1]?.trim();
}

export async function observeComputeResources() {
  const observedAt = new Date().toISOString();
  const googleAccounts = await gcloud(["auth", "list"]);
  const projectsReading = await gcloud(["projects", "list"]);
  const projects = [];
  for (const project of value(projectsReading)) {
    const id = project.projectId;
    const billing = await gcloud(["billing", "projects", "describe", id]);
    const services = await gcloud(["services", "list", "--enabled", `--project=${id}`]);
    const enabled = value(services).map((entry) => entry.config?.name).filter(Boolean);
    const run = enabled.includes("run.googleapis.com")
      ? await gcloud(["run", "services", "list", `--project=${id}`, "--platform=managed", "--region=us-central1"])
      : { status: "not-enabled" };
    const compute = enabled.includes("compute.googleapis.com") && billing.value?.billingEnabled !== false
      ? await gcloud(["compute", "instances", "list", `--project=${id}`])
      : { status: "not-enabled" };
    projects.push({
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
    });
  }

  const ociConfig = join(process.env.HOME ?? "", ".oci/config");
  const profiles = ociProfiles(ociConfig);
  const profile = profiles.find((name) => name.endsWith("_API_KEY")) ?? (profiles.includes("DEFAULT") ? "DEFAULT" : profiles[0]);
  let oracle = { status: "credential-unavailable", profiles };
  if (profile) {
    const tenancy = ociField(ociConfig, profile, "tenancy");
    const region = ociField(ociConfig, profile, "region");
    const tenancyReading = tenancy ? await oci(profile, ["iam", "tenancy", "get", "--tenancy-id", tenancy]) : { status: "unavailable", reason: "tenancy-not-configured" };
    const regions = tenancy ? await oci(profile, ["iam", "region-subscription", "list", "--tenancy-id", tenancy]) : { status: "unavailable", reason: "tenancy-not-configured" };
    const compartments = tenancy ? await oci(profile, ["iam", "compartment", "list", "--compartment-id", tenancy, "--compartment-id-in-subtree", "true", "--all"]) : { status: "unavailable", reason: "tenancy-not-configured" };
    const compartmentIds = [tenancy, ...(compartments.value?.data ?? []).map((item) => item.id)].filter(Boolean);
    const instances = [];
    for (const id of compartmentIds) {
      const reading = await oci(profile, ["compute", "instance", "list", "--compartment-id", id, "--all"]);
      instances.push({ compartmentId: id, status: reading.status, ...(reading.status === "observed" ? { items: (reading.value.data ?? reading.value).map((item) => ({ name: item["display-name"], state: item["lifecycle-state"], shape: item.shape, availabilityDomain: item["availability-domain"] })) } : { reason: reading.reason }) });
    }
    oracle = { status: tenancyReading.status, tenancyName: tenancyReading.value?.data?.name, configuredRegion: region, profiles, subscribedRegions: (regions.value?.data ?? []).map((item) => item["region-name"]), compartments: (compartments.value?.data ?? []).map((item) => ({ name: item.name, id: item.id })), instances };
  }

  let cloudflare = { status: "credential-unavailable" };
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    try {
      const provider = await import("@red-cup-engineering/cloudflare-services-section/derive-cloudflare-account-inventory");
      const reading = await provider.deriveCloudflareAccountInventory({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, tokenEnvironmentVariable: "CLOUDFLARE_API_TOKEN" });
      // Workers Builds native limits require separate Workers CI Read scope.
      // A route inventory token can be valid even if this capability is denied.
      let workersBuildMinutes = { status: "unavailable", reason: "reader-not-admitted" };
      if (typeof provider.observeCloudflareBuildMinutes === "function") {
        try {
          const allowance = await provider.observeCloudflareBuildMinutes({
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID, tokenEnvironmentVariable: "CLOUDFLARE_API_TOKEN",
          });
          workersBuildMinutes = allowance.type === "CloudflareWorkersBuildMinutesObservation"
            ? { status: allowance.status, observedAt: allowance.observedAt, refreshAt: allowance.refreshAt }
            : { status: "unavailable", reason: allowance.code ?? "unknown-refusal" };
        } catch { workersBuildMinutes = { status: "unavailable", reason: "native-build-observation-failed" }; }
      }
      cloudflare = reading.type === "CloudflareAccountInventory" ? {
        status: "observed", accountId: reading.accountId, counts: reading.counts, workersBuildMinutes,
        zones: reading.zones.map((zone) => ({ name: zone.name, status: zone.status,
          destinations: zone.records.filter((record) => ["A", "AAAA", "CNAME"].includes(record.type)).map((record) => ({ type: record.type, name: record.name, content: record.content, proxied: record.proxied })) })),
        workers: reading.workers.map((worker) => ({ name: worker.id, modifiedOn: worker.modifiedOn })),
        customDomains: reading.customDomains.map((domain) => ({ hostname: domain.hostname, service: domain.service, zoneName: domain.zoneName })),
      } : { status: "unavailable", reason: reading.code };
    } catch {
      cloudflare = { status: "unavailable", reason: "reader-failed" };
    }
  }

  const ssh = await command("ssh", ["-G", "cold-red-gate"]);
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
