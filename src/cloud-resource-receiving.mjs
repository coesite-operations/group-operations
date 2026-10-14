/**
 * Coesite's cloud-specific policy on the shared Red Cup causal resource head.
 *
 * Red Cup SEAVT owns native custody, stable SCA resource IDs, SCA witness
 * checking, clock comparison and compare-and-swap frontier semantics.
 * Coesite retains only which cloud facts it accepts and its public read type.
 * No second ledger or cloud-specific storage implementation is maintained here.
 */
import {createCausalResourceHead}
 from '@red-cup-engineering/semiotic-eavt-services-section/causal-resource-head';

const cloudResources=createCausalResourceHead({
 recordType:'cloud-resource',
 witnessType:'cloud-observation',
 event:'cloud-resource-observed'
});

/** Keep the existing Group operator API while delegating native storage law. */
export const receiveCloudResourceRow=(root,row)=>cloudResources.receive(root,row);

/** A read is an original current-state projection, not a new resource claim. */
export const readCloudResource=(root,subject)=>{
 const reading=cloudResources.read(root,subject);
 if(reading===null)return null;
 return Object.freeze({...reading,kind:'561-group.cloud-resource-current'});
};
