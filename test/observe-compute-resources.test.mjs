import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Exercise the *real owning module* from outside the historic monorepo, with
// bounded native CLI fixtures. These are tests, never a claim of cloud access.
const source = new URL('../src/observe-compute-resources.mjs', import.meta.url).href;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'coesite-cloud-'));
  const home = join(root, 'home'), bin = join(root, 'bin');
  mkdirSync(home); mkdirSync(bin); mkdirSync(join(home, '.oci'));
  writeFileSync(join(home, '.oci/config'),
    '[DEFAULT]\ntenancy=ocid1.tenancy.oc1..testfixture\nregion=us-ashburn-1\nkey_file=/no-secret-loaded\n');
  const cli = (name, script) => writeFileSync(join(bin, name), `#!${process.execPath}\n${script}\n`, { mode: 0o755 });
  cli('gcloud', `const a=process.argv.slice(2); console.log(JSON.stringify(a[0]==='auth'?[{account:'fixture@example.test',status:'ACTIVE'}]:[]));`);
  cli('oci', `const a=process.argv.slice(2);
    if(!a.includes('--profile')||a[a.indexOf('--profile')+1]!=='DEFAULT')process.exit(7);
    console.log(JSON.stringify({data:a.includes('tenancy')?{name:'test tenancy'}:[]}));`);
  cli('ssh', `console.log('hostname test-cold-red-gate.example');`);
  return {root,home,bin,cli};
}
function read(f, envChanges={}) {
  const body=`import {observeComputeResources} from ${JSON.stringify(source)};
    let eventLoopResponsive=false;
    const pending=observeComputeResources();
    setImmediate(()=>{eventLoopResponsive=true;});
    const record=await pending;
    process.stdout.write(JSON.stringify({eventLoopResponsive,record}));`;
  const stdout=execFileSync(process.execPath,['--input-type=module','--eval',body],{
    cwd:tmpdir(), env:{...process.env,PATH:f.bin,HOME:f.home,
      CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:'',...envChanges},
    encoding:'utf8',timeout:12000,maxBuffer:1024*1024,
  });
  return JSON.parse(stdout);
}

test('standalone provider observer loads, stays async, and recognizes OCI DEFAULT',()=>{
  const f=fixture();
  try {
    const {eventLoopResponsive,record}=read(f);
    assert.equal(eventLoopResponsive,true,'native CLI waits must not stop ActivityPub event loop');
    assert.equal(record.kind,'compute-resource-observation');
    assert.equal(record.googleCloud.status,'observed');
    assert.deepEqual(record.googleCloud.projects,[]);
    assert.equal(record.oracleCloud.status,'observed');
    assert.equal(record.oracleCloud.configuredRegion,'us-ashburn-1');
    assert.ok(record.oracleCloud.profiles.includes('DEFAULT'));
    assert.equal(record.credentials.find(x=>x.provider==='oracle-cloud').configured,true);
    assert.equal(record.cloudflare.status,'credential-unavailable');
    assert.equal(record.machines.at(-1).hostname,'test-cold-red-gate.example');
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('native CLI refusal does not disclose provider stderr or invent headroom',()=>{
  const f=fixture();
  try {
    f.cli('gcloud', `process.stderr.write('DUMMY_FORBIDDEN_SECRET_VALUE\\n'); process.exit(11);`);
    const {record}=read(f);
    assert.equal(record.googleCloud.status,'unavailable');
    assert.deepEqual(record.googleCloud.projects,[]);
    assert.equal(JSON.stringify(record).includes('DUMMY_FORBIDDEN_SECRET_VALUE'),false);
  } finally {rmSync(f.root,{recursive:true,force:true});}
});

test('upstream Cloudflare reader is a declared Engineering package, not an absolute workspace import',()=>{
  const groupPackage=JSON.parse(
    execFileSync(process.execPath, ['-e',
      'const fs=require("fs");process.stdout.write(fs.readFileSync(process.argv[1],"utf8"))',
      fileURLToPath(new URL('../package.json',import.meta.url))],{encoding:'utf8'}));
  assert.equal(groupPackage.dependencies['@red-cup-engineering/cloudflare-services-section'],'workspace:*');
});
