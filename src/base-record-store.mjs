import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyBaseSpotRecord} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
const key=reference=>{if(typeof reference!=='string'||!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/.test(reference))throw new TypeError('native-base-record-reference-required');return createHash('sha256').update(reference).digest('hex');};
/** Native semantic identity is the lookup key. A filename is only its encoding. */
export async function persistBaseFleetRecord({directory,record}){
 verifyBaseSpotRecord(record);const name=key(record.id);await mkdir(directory,{recursive:true,mode:0o700});
 const body={venue:'evm',...record},serialized=JSON.stringify(body)+'\n';if(Buffer.byteLength(serialized)>1048576)throw new TypeError('bounded-base-record-required');
 const file=join(directory,name+'.json');
 try{await writeFile(file,serialized,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;await readBaseFleetRecord({directory,reference:record.id});}
 return {...body,fleetRecord:record.id};
}
export async function readBaseFleetRecord({directory,reference}){
 const handle=await open(join(directory,key(reference)+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await handle.stat();if(!info.isFile()||info.size>1048576||(info.mode&0o077)!==0||info.uid!==process.getuid())throw new TypeError('bounded-private-base-record-required');
  const bytes=Buffer.alloc(info.size+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead!==info.size)throw new TypeError('base-record-changed-during-read');
  const serialized=bytes.subarray(0,bytesRead).toString('utf8'),stored=JSON.parse(serialized),{venue,...record}=stored;
  if(venue!=='evm'||record.id!==reference||serialized!==JSON.stringify(stored)+'\n')throw new TypeError('native-base-record-identity-mismatch');
  return verifyBaseSpotRecord(record);
 }finally{await handle.close();}
}
