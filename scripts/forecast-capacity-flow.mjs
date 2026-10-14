#!/usr/bin/env node
import { assessOfficeCapacityIntervention } from "../src/capacity-flow-operation.mjs";

const limit=1_048_576;
let bytes=0;const chunks=[];
try{
  for await(const chunk of process.stdin){
    bytes+=chunk.byteLength;
    if(bytes>limit)throw new RangeError("bounded capacity demand exceeded 1 MiB");
    chunks.push(chunk);
  }
  let request;
  try{request=JSON.parse(Buffer.concat(chunks).toString("utf8"))}
  catch{throw new TypeError("capacity scenario is invalid JSON")}
  const result=assessOfficeCapacityIntervention(request);
  process.stdout.write(JSON.stringify({ok:true,result,providerMutation:false,workTransfer:false})+"\n");
}catch(err){
  const reason=err?.message==="bounded capacity demand exceeded 1 MiB"
    ? "bounded capacity demand exceeded 1 MiB" : "invalid or unqualified capacity evidence";
  process.stdout.write(JSON.stringify({ok:false,refusal:{kind:"CapacityFlowAdmissionRefusal",reason},
    providerMutation:false,workTransfer:false})+"\n");
  process.exitCode=2;
}
