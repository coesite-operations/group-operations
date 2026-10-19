import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonRepr } from "@red-cup-engineering/http-services-section/representation";
import { guardOperators, isOperator } from "@red-cup-engineering/metroplat-operations-console/people";
import { currentPeerEvidence } from "./peer-evidence.mjs";
import { projectCloudResourceClaims } from "./cloud-resource-claims.mjs";
import { readCloudResource } from "./cloud-resource-receiving.mjs";
import { readGroupResourceFlows } from "./group-resource-flows.mjs";

export const COMPUTE_OBJECT_KIND = "561-group.compute-resource-observation.v1";
const validComputeRecord = (record) => record?.kind === "compute-resource-observation"
  && typeof record.observedAt === "string" && Number.isFinite(Date.parse(record.observedAt))
  && Array.isArray(record.googleCloud?.projects) && Array.isArray(record.credentials);

/** The Group's dated compute observation (Google Cloud, Oracle Cloud, Cloudflare, machines and
 * credential locations, never credential values), refreshed by the Group operations
 * compute resource operation before placement decisions. */
export function readComputeRecord(computeRecordPath) {
  const record = JSON.parse(readFileSync(computeRecordPath, "utf8"));
  if (!validComputeRecord(record)) {
    throw new TypeError("compute resource observation is invalid");
  }
  return record;
}

export function currentGroupComputeRecord({ config, authorActor }) {
  if (new URL(authorActor).origin === new URL(config.publicBaseUrl).origin) {
    return readComputeRecord(join(config.dataDir, "records/compute-resources.json"));
  }
  const evidence = currentPeerEvidence({
    config, authorActor, objectKind: COMPUTE_OBJECT_KIND,
    validValue: (value) => value?.type === "GroupComputeResourceObservation"
      && value.asOf === value.record?.observedAt && validComputeRecord(value.record),
  });
  return evidence?.record ?? null;
}

/** The Group's dated compute observation, local at its author and federated at its peer. */
export function groupOperations({ config, configuration = {} }) {
  const navigation = Object.assign([
    { href: "/play", label: "Play" }, { href: "/tasks/view", label: "Work" },
    { href: "/books/group-readout", label: "Daily readout" },
    { href: "/books/resource-flows", label: "Resource flows" },
    { href: "/businesses/summary", label: "Businesses" }, { href: "/compute", label: "Compute" },
  ], { title: configuration.label ?? "Group" });
  const authorActor = configuration.computeAuthorActor;
  if (typeof authorActor !== "string" || new URL(authorActor).protocol !== "https:") {
    throw new TypeError("Group compute observation requires its author actor");
  }
  const readCompute = () => currentGroupComputeRecord({ config, authorActor });
  const mayReadCompute = (context) => {
    const claims = context?.principal;
    return isOperator(claims === undefined ? null : { provider: "bearer", subjectHash: claims.subject, label: claims.principal?.name ?? claims.subject },
      { stateDir: config.stateDir, allowedEmail: config.allowedEmail });
  };
  const resources = [
    {
      id: "ops-control-plane.compute",
      match: "/compute",
      methods: ["GET"],
      produces: ["application/json"],
      handler: () => {
        let record;
        try { record = readCompute(); }
        catch (error) {
          if (error?.code === "ENOENT") return jsonRepr({ error: "compute_inventory_unavailable", reason: "Refresh the compute resource observation" }, { status: 503, cacheControl: { noStore: true } });
          return jsonRepr({ error: "compute_inventory_invalid" }, { status: 502, cacheControl: { noStore: true } });
        }
        if (record === null) return jsonRepr({ error: "compute_inventory_unavailable", reason: "No admitted observation from the author instance" }, { status: 503, cacheControl: { noStore: true } });
        return jsonRepr({ ...record, resourcePredications: projectCloudResourceClaims(record) }, { cacheControl: { noStore: true } });
      },
    },
    {
      id: "ops-control-plane.compute-resource-cells",
      match: "/compute/resources",
      methods: ["GET"],
      produces: ["application/json"],
      handler: () => {
        let record;
        try { record=readCompute(); }
        catch { return jsonRepr({error:"compute_resource_evidence_unavailable"},
          {status:503,cacheControl:{noStore:true}}); }
        if(record===null)return jsonRepr({error:"compute_resource_evidence_unavailable"},
          {status:503,cacheControl:{noStore:true}});
        return jsonRepr(projectCloudResourceClaims(record),
          {cacheControl:{noStore:true}});
      },
    },
  ];
    // Read the original source-owned accounting engines on demand; do not
    // persist a second ledger of four redundant time-window aggregates.
    resources.push({
      id:"group-resource-flows.daily",
      match:"/books/resource-flows",
      methods:["GET"],produces:["application/json"],
      handler:async()=>{
        const date=new Date().toISOString().slice(0,10);
        const reading=await readGroupResourceFlows({date,resolution:"day"});
        return jsonRepr(reading,{cacheControl:{noStore:true}});
      }
    });
    const tools = [Object.freeze({
    name: "compute_resources",
    description: "Read the dated observations of Google Cloud, Oracle Cloud, Cloudflare, machines, and credential locations before selecting compute for work.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    visible: mayReadCompute,
    handler: (_input, context) => {
      if (!mayReadCompute(context)) throw new Error("compute resources require an operator");
      const record = readCompute();
      if (record === null) throw new Error("No admitted compute observation from the author instance");
      return { ...record, resourcePredications: projectCloudResourceClaims(record) };
    },
  }),Object.freeze({
    name: "compute_resource",
    description: "Read one cloud compute or data resource at its stable SCA ni: subject, from the installed native SEAVT store or the last authenticated signed peer observation.",
    inputSchema: {type:"object",required:["subject"],properties:{subject:{type:"string"}},additionalProperties:false},
    annotations: {readOnlyHint:true,idempotentHint:true,openWorldHint:false},
    visible: mayReadCompute,
    handler: ({subject},context) => {
      if(!mayReadCompute(context))throw new Error("cloud resource requires an operator");
      if(typeof subject!=="string"||!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(subject))
        throw new TypeError("an exact SCA ni: resource subject is required");
      if(new URL(authorActor).origin===new URL(config.publicBaseUrl).origin)
        return readCloudResource(config.dataDir,subject) ??
          {kind:"561-group.cloud-resource-current",subject,state:"unobserved-in-native-store"};
      // A signed peer reading is useful, but cannot be misreported as a
      // locally committed native SEAVT resource head. Never mutate a
      // read-only MCP request to install remote claims.
      const record=readCompute();
      if(record===null)return {kind:"561-group.cloud-resource-current",subject,state:"peer-observation-unavailable"};
      const facts=projectCloudResourceClaims(record);
      const index=facts.resourceSubjects.indexOf(subject);
      return index<0
        ? {kind:"561-group.cloud-resource-current",subject,state:"unobserved-in-signed-peer"}
        : {kind:"561-group.cloud-resource-current",subject,
            state:"signed-peer-projection-not-locally-stored",asOf:facts.asOf,
            sourceCommitment:facts.sourceCommitment,observation:facts.rows[index]};
    },
  })];
  tools.push(Object.freeze({
    name:"resource_flows",
    description:"Read exact UTC second/minute/hour/day resource flows from the Group's original money journal and inference event store; missing physical host meters are explicit.",
    inputSchema:{type:"object",required:["date"],additionalProperties:false,
      properties:{date:{type:"string"},resolution:{enum:["second","minute","hour","day"]},
        account:{type:"string"}}},
    annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false},
    visible:mayReadCompute,
    handler:async(input,context)=>{
      if(!mayReadCompute(context))throw new Error("resource flows require an operator");
      return readGroupResourceFlows(input);
    }
  }));
    return { tools, applications: [guardOperators({ resources }, () => true, {
    stateDir: config.stateDir, allowedEmail: config.allowedEmail,
    navigation, navigationTitle: navigation.title,
  })] };
}
