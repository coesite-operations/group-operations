// Existing SignCell/SCA identity and EAVT carrier, not a new cloud registry.
// A resource is distinguished from a statement *about* that resource: the
// former retains one NI address; each dated provider observation is a new
// predication, with its own SignCell witness and provenance.
import {address,utteranceCell,triple} from '@red-cup-engineering/signcell/cell';
import {semanticId} from '@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address';
import {seavtOfJson,isAbsoluteSeavtClock} from '@red-cup-engineering/semiotic-eavt-services-section/admit-seavt-row';

const nonempty=x=>typeof x==='string'&&x.trim().length>0;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=s=>{throw new TypeError('cloud resource projection: '+s);};
const observed=x=>x?.status==='observed';
const bounded=rows=>Array.isArray(rows)&&rows.length<=512?rows:fail('bounded provider collection required');
const canonicalIdentity=(provider,kind,native)=>address(utteranceCell('cloud-resource-coordinate',
  Object.freeze({provider,kind,native})));
// Canonical source bytes remain in their owned provider observation custody.
 // SignCell witnesses commit to them by SCA content identity; the compact
 // admitted triple is itself durable in the existing SEAVT store.
const witnessOf=(record)=>{
  const sourceCommitment=semanticId({kind:record.kind,observedAt:record.observedAt,
    googleCloud:record.googleCloud,oracleCloud:record.oracleCloud,cloudflare:record.cloudflare});
  const cell=utteranceCell('cloud-compute-native-observation',
    {sourceCommitment,observedAt:record.observedAt,carrier:record.kind});
  return Object.freeze({id:address(cell),record:triple(cell),sourceCommitment});
};

/**
 * Project one genuine dated provider reading as SignCell-addressed SEAVT rows
 * {e,a,v,t,causes}. A positive existence observation is *not* proof of
 * allocation, ownership, reuse license, supplier authority, billing, or offer.
 * This is a pure projection; @.../semiotic-eavt-services-section/store owns
 * journal persistence and the existing SEN ActivityPub peer carries claims.
 */
export function projectCloudResourceClaims(record){
  if(!object(record)||record.kind!=='compute-resource-observation'
      ||!isAbsoluteSeavtClock(record.observedAt))
    fail('native observation envelope required');
  const t=record.observedAt,witness=witnessOf(record),rows=[],subjects=[],seen=new Set();
  function claim(provider,kind,native,reading,attrs={}){
    if(!nonempty(provider)||!nonempty(kind)||!nonempty(native)||!object(reading))
      fail('typed provider identity and claim required');
    const e=canonicalIdentity(provider,kind,native);
    if(!nonempty(e)||seen.has(e))fail('ambiguous or duplicate resource identity');
    seen.add(e);subjects.push(e);
    const v=Object.freeze({
      kind,provider,
      ...attrs,
      availability:reading,
      custody:Object.freeze({providerPrincipal:'not-independently-verified',
        rightsToPublish:'unverified',rightsToResell:'unverified'}),
      commerce:Object.freeze({offer:'not-admitted',price:'unpriced',
        settlement:'unobserved',executionPermission:'unverified'}),
    });
    // These are actually admitted SEN coordinates of a SEAVT observation,
    // not a JSON object merely described as SEAVT. The causal edge uses the
    // store's existing typed cross-record reference to the retained witness.
    rows.push(Object.freeze({
      ...seavtOfJson(e,{event:'cloud-resource-observed',provider,resourceKind:kind},v,t),
      causes:Object.freeze([{type:'cloud-observation',id:witness.id}]),
    }));
    if(rows.length>512)fail('resource observation exceeds bounded graph');
  }
  const google=record.googleCloud;
  if(observed(google)){
    for(const project of bounded(google.projects)){
      if(!nonempty(project?.projectId))fail('Google project native ID missing');
      const billing=project.billing?.status==='observed'
        ? (project.billing.enabled===true?'enabled':project.billing.enabled===false?'disabled':'unknown')
        :'unknown';
      claim('google-cloud','project',project.projectId,
        {exists:'held',freeHeadroom:'unknown',billing,
          newExecution:billing==='disabled'?'denied':'unknown'},
        {nativeProject:project.projectId,
          services:bounded(project.enabledComputeServices??[]).filter(nonempty)});
      if(observed(project.cloudRunUsCentral1)){
        for(const service of bounded(project.cloudRunUsCentral1.services)){
          if(!nonempty(service?.name))fail('Cloud Run service name missing');
          claim('google-cloud','cloud-run-service',project.projectId+':us-central1:'+service.name,
            {exists:'held',running:service.ready==='True'?'held':'unknown',
              freeHeadroom:'unknown',billing},
            {project:project.projectId,region:'us-central1',
              name:service.name,revision:service.latestReadyRevision??null});
        }
      }
      if(observed(project.computeInstances)){
        for(const instance of bounded(project.computeInstances.instances)){
          if(!nonempty(instance?.name)||!nonempty(instance?.zone))fail('Compute Engine instance ID incomplete');
          claim('google-cloud','compute-instance',project.projectId+':'+instance.zone+':'+instance.name,
            {exists:'held',running:instance.status==='RUNNING'?'held':'unknown',
              freeHeadroom:'unknown',billing},
            {project:project.projectId,zone:instance.zone,name:instance.name,
              machineType:instance.machineType??null});
        }
      }
      if(observed(project.storageBuckets)){
        for(const bucket of bounded(project.storageBuckets.buckets)){
          if(!nonempty(bucket?.name))fail('GCS bucket native identity missing');
          claim('google-cloud','storage-bucket',project.projectId+':'+bucket.name,
            {exists:'held',bytes:'unknown',license:'unknown',freeHeadroom:'unknown'},
            {project:project.projectId,name:bucket.name,location:bucket.location??null,
              storageClass:bucket.storageClass??null});
        }
      }
    }
  }
  const oracle=record.oracleCloud;
  if(observed(oracle)&&nonempty(oracle.tenancyName)&&nonempty(oracle.tenancyIdentity)){
    claim('oracle-cloud','tenancy',oracle.tenancyIdentity,
      {exists:'held',quota:'unknown',hostStock:'unknown',billing:'unknown',newExecution:'unknown'},
      {region:oracle.configuredRegion??null,accountIdentity:oracle.tenancyIdentity});
    for(const compartment of bounded(oracle.instances??[])){
      if(compartment.status!=='observed')continue;
      for(const instance of bounded(compartment.items)){
        const instanceId=instance?.nativeIdentity??(nonempty(compartment.compartmentId)&&nonempty(instance?.name)
          ? compartment.compartmentId+':'+instance.name:null);
        if(!nonempty(instanceId))fail('OCI VM stable native identity missing');
        claim('oracle-cloud','compute-instance',oracle.tenancyIdentity+':'+instanceId,
          {exists:'held',running:instance.state==='RUNNING'?'held':'unknown',
            freeHeadroom:'unknown',hostStock:'unknown'},
          {name:instance.name??null,shape:instance.shape??null,
            availabilityDomain:instance.availabilityDomain??null});
      }
    }
    for(const scope of bounded(oracle.objectStorage?.buckets??[])){
      if(scope.status!=='observed')continue;
      for(const bucket of bounded(scope.items)){
        if(!nonempty(bucket?.name)||!nonempty(bucket?.namespace)||!nonempty(scope.compartmentId))
          fail('OCI Object Storage bucket coordinate incomplete');
        claim('oracle-cloud','storage-bucket',
          oracle.tenancyIdentity+':'+scope.compartmentId+':'+bucket.namespace+':'+bucket.name,
          {exists:'held',bytes:'unknown',license:'unknown',freeHeadroom:'unknown'},
          {name:bucket.name,storageTier:bucket.storageTier??null});
      }
    }
  }
  const cf=record.cloudflare;
  if(nonempty(cf?.accountId)){
    claim('cloudflare','account',cf.accountId,
      {exists:observed(cf)||observed(cf.r2Buckets)?'held':'unknown',freeHeadroom:'unknown',
        workersBuildMinutes:cf.workersBuildMinutes?.status??'unknown'},
      {account:cf.accountId});
    if(observed(cf)){
      for(const worker of bounded(cf.workers??[])){
        if(!nonempty(worker?.name))fail('Cloudflare Worker native identity missing');
        claim('cloudflare','worker',cf.accountId+':'+worker.name,
          {exists:'held',freeHeadroom:'unknown',execution:'unknown'},
          {name:worker.name,modifiedAt:worker.modifiedOn??null});
      }
    }
    if(observed(cf.r2Buckets)&&cf.r2Buckets.coverage==='complete'){
      for(const bucket of bounded(cf.r2Buckets.buckets)){
        if(!nonempty(bucket?.name))fail('R2 bucket identity missing');
        claim('cloudflare','storage-bucket',cf.accountId+':'+bucket.name,
          {exists:'held',bytes:'unknown',license:'unknown',freeHeadroom:'unknown'},
          {name:bucket.name,jurisdiction:bucket.jurisdiction??null,
            location:bucket.location??null,storageClass:bucket.storageClass??null});
      }
    }
  }
  return Object.freeze({kind:'561-group.cloud-resource-predications',asOf:t,
    observationWitness:witness.id,sourceCommitment:witness.sourceCommitment,
    witnessRecord:witness.record,resourceSubjects:Object.freeze(subjects),
    rows:Object.freeze(rows)});
}
