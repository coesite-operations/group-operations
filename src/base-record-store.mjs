import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,link,unlink,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {verifyBaseSpotRecord} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
const key=reference=>{if(typeof reference!=='string'||!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/.test(reference))throw new TypeError('native-base-record-reference-required');return createHash('sha256').update(reference).digest('hex');};
/** Native semantic identity is the lookup key. A filename is only its encoding. */
export async function persistBaseFleetRecord({directory,record}){
 verifyBaseSpotRecord(record);const name=key(record.id);
 if(!isAbsolute(directory??''))throw new TypeError('absolute-base-record-directory-required');
 await mkdir(directory,{recursive:true,mode:0o700});
 const root=await lstat(directory);
 if(!root.isDirectory()||root.uid!==process.getuid()||(root.mode&0o022)!==0)throw new TypeError('owned-base-record-directory-required');
 const body={venue:'evm',...record},serialized=JSON.stringify(body)+'\n';if(Buffer.byteLength(serialized)>1048576)throw new TypeError('bounded-base-record-required');
 const file=join(directory,name+'.json'),temporary=join(directory,'.'+name+'.'+randomUUID()+'.pending');
 const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  await handle.writeFile(serialized);await handle.sync();await handle.close();
  try{await link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;await readBaseFleetRecord({directory,reference:record.id});}
  const parent=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await parent.sync();}finally{await parent.close();}
 }finally{await handle.close();await unlink(temporary);}
 return {...body,fleetRecord:record.id};
}
export async function readBaseFleetRecord({directory,reference}){
 if(!isAbsolute(directory??''))throw new TypeError('absolute-base-record-directory-required');
 const root=await lstat(directory);
 if(!root.isDirectory()||root.uid!==process.getuid()||(root.mode&0o022)!==0)throw new TypeError('owned-base-record-directory-required');
 const handle=await open(join(directory,key(reference)+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=await handle.stat({bigint:true});
  if(!info.isFile()||info.size>1048576n||(info.mode&0o077n)!==0n||info.uid!==BigInt(process.getuid()))throw new TypeError('bounded-private-base-record-required');
  const bytes=Buffer.alloc(Number(info.size)+1);let bytesRead=0;
  while(bytesRead<bytes.length){const chunk=await handle.read(bytes,bytesRead,bytes.length-bytesRead,bytesRead);if(chunk.bytesRead===0)break;bytesRead+=chunk.bytesRead;}
  const after=await handle.stat({bigint:true});
  if(BigInt(bytesRead)!==info.size||after.size!==info.size||after.mtimeNs!==info.mtimeNs||after.ctimeNs!==info.ctimeNs||after.mode!==info.mode||after.uid!==info.uid)throw new TypeError('base-record-changed-during-read');
  const serialized=bytes.subarray(0,bytesRead).toString('utf8');let stored;
  try{stored=JSON.parse(serialized);}catch{throw new TypeError('base-record-json-invalid');}
  const {venue,...record}=stored;
  if(venue!=='evm'||record.id!==reference||serialized!==JSON.stringify(stored)+'\n')throw new TypeError('native-base-record-identity-mismatch');
  return verifyBaseSpotRecord(record);
 }finally{await handle.close();}
}

/** Bounded private replay of an already retained, verified native record. */
export async function readBaseFleetRecordWindow({directory,reference,offset=0,limit=32768}){
 if(!Number.isSafeInteger(offset)||offset<0||offset>1048576||!Number.isSafeInteger(limit)||limit<1||limit>32768)throw new TypeError('bounded-base-record-window-required');
 const record=await readBaseFleetRecord({directory,reference});
 const bytes=Buffer.from(JSON.stringify(record));
 if(offset>bytes.length)throw new TypeError('base-record-window-outside-artifact');
 const chunk=bytes.subarray(offset,offset+limit);
 return {reference:record.id,mediaType:'application/json',offset,returnedBytes:chunk.length,totalBytes:bytes.length,bytesBase64:chunk.toString('base64'),complete:offset+chunk.length===bytes.length,artifactId:'ni:///sha-256;'+createHash('sha256').update(bytes).digest('base64url'),accountRecord:true,orderEffect:false};
}
