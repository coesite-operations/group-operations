import {persistBaseFleetRecord,readBaseFleetRecord,readBaseFleetRecordWindow} from './base-record-store.mjs';
import {discoverObservedBaseTokens} from './base-observed-tokens.mjs';
import {reconcileSettlementPayout} from '@red-cup-engineering/kalshi-services-section/settlement-accounting';
import {readDeskAuthority} from '@red-cup-engineering/kalshi-services-section/desk-authority';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createMcpClient,mcpInProcessTransport} from '@red-cup-engineering/mcp-engineering-services-section/client';
import {createAlpacaLiveMcp,alpacaLiveTools} from '@red-cup-engineering/alpaca-principal-actuation-service/mcp';
import {openProductionAlpacaBrokerage} from '@red-cup-engineering/alpaca-principal-actuation-service';
import {createPublicEvmReadPool,BASE_PUBLIC_EVM_CHAIN,BASE_PUBLIC_EVM_PROVIDERS} from '@red-cup-engineering/ethereum-engineering-services-section/public-evm-read';
import {BASE_SPOT,baseSpotRecordId,verifyBaseSpotRecord,createBaseSpotAdapter,createBaseNativeUsdcRecovery,reconcileBaseNativeUsdcOutcome} from '@red-cup-engineering/pluggable-venue-adapter-service/base-spot';
import {createSemanticRecordJournal} from '@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record';
import {createKalshiClient} from '@red-cup-engineering/kalshi-services-section/client';
const empty={type:'object',properties:{},additionalProperties:false};
const venueTools=Object.freeze([
 {name:'base_fleet_read_record',description:'Read at most 32768 exact bytes of one retained private Base account, quote or unsigned preparation record. Verifies its native identity; no fresh observation, signing or trade authority.',inputSchema:{type:'object',properties:{reference:{type:'string',pattern:'^ni:///sha-256;[A-Za-z0-9_-]{43}$'},offset:{type:'integer',minimum:0,maximum:1048576},limit:{type:'integer',minimum:1,maximum:32768}},required:['reference'],additionalProperties:false}},
 {name:'base_fleet_observe',description:'Read native ETH, WETH, native USDC and up to 128 declared ERC-20 balances at one fixed block. Coverage remains explicitly partial and unvalued. No signing.',inputSchema:{type:'object',properties:{tokens:{type:'array',maxItems:BASE_SPOT.maximumObservedTokens,uniqueItems:true,items:{type:'string',pattern:'^0x[0-9a-fA-F]{40}$'}}},additionalProperties:false}},
 {name:'base_fleet_reconcile',description:'Recover the existing 0x224 pending transaction by its original hash, canonical finalized receipt and recorded outcome. No signing or broadcast. Exact finalized ETH/USDC/WETH quantities and receipt fees must reconcile before effect custody clears. USD profit remains unclaimed without cost basis.',inputSchema:empty},
 {name:'base_fleet_quote_native_usdc',description:'Observe an executable native ETH to native USDC Uniswap quote for 0x224 at one block. Persist the quote; no signing or venue write.',inputSchema:{type:'object',properties:{amountInWei:{type:'string',pattern:'^[0-9]{1,78}$'},fee:{type:'integer',enum:[100,500,3000,10000]}},required:['amountInWei'],additionalProperties:false}},
 {name:'base_fleet_prepare_native_usdc',description:'Prepare a recorded native ETH to USDC quote with fixed-block simulation and rollup fee reserves. Returns an unsigned transaction; current mandate admission and pending nonce checks remain required.',inputSchema:{type:'object',properties:{quoteReference:{type:'string',pattern:'^ni:///sha-256;[A-Za-z0-9_-]{43}$'},minimumOutputAtomic:{type:'string',pattern:'^[0-9]{1,78}$'},deadline:{type:'integer'}},required:['quoteReference','minimumOutputAtomic','deadline'],additionalProperties:false}},
 {name:'kalshi_fleet_observe',description:'Read and persist Kalshi balance, positions, resting orders, fills and settlements through its existing signer-host client.',inputSchema:empty},
]);

/** One authenticated fleet entrance on the production host; each venue retains its custody. */
export function tradingFleetNetworkSources({environment,config}){
 const root=environment.TRADING_FLEET_STATE_DIR??join(homedir(),'.local/state/561-group/trading-fleet');
 const brokerage=openProductionAlpacaBrokerage({stateRoot:environment.ALPACA_LIVE_STATE_DIR??join(root,'alpaca'),custodyRoot:environment.ALPACA_LIVE_CUSTODY_DIR??join(homedir(),'.config/561-group/alpaca-live-custody')});
 const alpaca=createAlpacaLiveMcp({brokerage});
 const base=createBaseSpotAdapter({readPool:createPublicEvmReadPool({chain:BASE_PUBLIC_EVM_CHAIN,providers:BASE_PUBLIC_EVM_PROVIDERS,maxAttemptsPerProvider:1,maxCallsPerOperation:BASE_PUBLIC_EVM_PROVIDERS.length*(BASE_SPOT.maximumObservedTokens+8)})});
 const recoverBase=async()=>{
  let selected;
  const call=async(provider,request)=>{
   const response=await fetch(provider.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,...request}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new TypeError('base-recovery-rpc-http-'+response.status);
   const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)throw new TypeError('bounded-base-recovery-rpc-response-required');
   const body=JSON.parse(text);if(body.jsonrpc!=='2.0'||body.id!==1||body.error||!Object.hasOwn(body,'result'))throw new TypeError('base-recovery-rpc-response-refused');return body.result;
  };
  const rpc=async request=>{
   if(!selected){for(const provider of BASE_PUBLIC_EVM_PROVIDERS){try{if(BigInt(await call(provider,{method:'eth_chainId',params:[]}))!==8453n)continue;selected=provider;break;}catch{}}if(!selected)throw new TypeError('base-recovery-provider-unavailable');}
   return call(selected,request);
  };
  const recordOutcome=async observed=>{
   const evidenceRoot=join(root,'knowledge');await mkdir(evidenceRoot,{recursive:true,mode:0o700});
   const journal=createSemanticRecordJournal({root:evidenceRoot,objectKind:'561-group.financial-fleet-pulse'});
   let accounting;
   try{accounting=await reconcileBaseNativeUsdcOutcome({observed,rpc});}
   catch(error){accounting={accountReconciled:false,feesReconciled:false,realizedPnlUsd:null,reason:error.message};}
   const evidence=journal.record({category:'venue-execution-observation',record:{venue:'base',observed,accounting,accountReconciled:accounting.accountReconciled,feesReconciled:accounting.feesReconciled,realizedPnlUsd:null},recordedAt:observed.observedAt,told:{for:true,against:false}});
   return {id:evidence.id,transactionHash:observed.transactionHash,accountReconciled:accounting.accountReconciled,feesReconciled:accounting.feesReconciled};
  };
  return createBaseNativeUsdcRecovery({directory:join(root,'evm','execution'),rpc,recordOutcome}).reconcile();
 };
 const persist=async(venue,record)=>{
  if(venue==='evm')return persistBaseFleetRecord({directory:join(root,'evm','observations'),record});
  const body={venue,...record};const serialized=JSON.stringify(body);const id=createHash('sha256').update(serialized).digest('hex');const dir=join(root,venue,'observations');await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,id+'.json');
  try{await writeFile(file,serialized+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;if(await readFile(file,'utf8')!==serialized+'\n')throw new TypeError('fleet-observation-identity-reused');}
  return {...body,fleetRecord:id};
 };
 const handle=async message=>{
  const id=message?.id??null;
  if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string')return {jsonrpc:'2.0',id,error:{code:-32600,message:'invalid request'}};
  if(message?.method==='tools/list'&&message.id!==undefined)return {jsonrpc:'2.0',id,result:{tools:[...alpacaLiveTools,...venueTools]}};
  const tool=venueTools.find(tool=>tool.name===message?.params?.name);
  if(message?.method!=='tools/call'||!tool)return alpaca(message);
  if(message.jsonrpc!=='2.0')return {jsonrpc:'2.0',id,error:{code:-32600,message:'invalid request'}};
  if(message.id===undefined)return undefined;
  try{
   const input=message.params.arguments??{};
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!Object.hasOwn(tool.inputSchema.properties,key)))throw new TypeError('exact-fleet-read-arguments-required');
   let value;
   if(tool.name==='base_fleet_read_record')value=await readBaseFleetRecordWindow({directory:join(root,'evm','observations'),...input});
   else if(tool.name==='base_fleet_observe'){
    const selection=Object.hasOwn(input,'tokens')?{tokens:input.tokens,sourceFleetRecords:[]}:await discoverObservedBaseTokens({directory:join(root,'evm','observations'),address:BASE_SPOT.address,maxTokens:BASE_SPOT.maximumObservedTokens});
    const account=verifyBaseSpotRecord(await base.readAccount({tokens:selection.tokens})),{id,...body}=account;
    const observation={...body,tokenSelection:{method:Object.hasOwn(input,'tokens')?'explicit-request':'previously-witnessed-holdings',sourceFleetRecords:selection.sourceFleetRecords}};
    value=await persist('evm',{id:baseSpotRecordId(observation),...observation});
   }else if(tool.name==='base_fleet_reconcile')value=await recoverBase();
   else if(tool.name==='base_fleet_quote_native_usdc'){
    if(typeof input.amountInWei!=='string'||!/^\d{1,78}$/.test(input.amountInWei))throw new TypeError('bounded-native-input-required');
    value=await persist('evm',await base.quoteNativeToUsdc(input));
   }else if(tool.name==='base_fleet_prepare_native_usdc'){
    const quote=await readBaseFleetRecord({directory:join(root,'evm','observations'),reference:input.quoteReference});
    value=await persist('evm',await base.prepareNativeUsdcSwap({quote,minimumOutputAtomic:input.minimumOutputAtomic,deadline:input.deadline}));
   }else{
    const client=createKalshiClient();const observedAt=new Date().toISOString();const min_ts=Math.floor(Date.parse(observedAt)/1000)-7*86400;
    const [balance,positions,orders,fills,settlements]=await Promise.all([client.getBalance(),client.getPositions({count_filter:'position'}),client.getOrders({status:'resting'}),client.getFills({min_ts}),client.getSettlements({min_ts})]);
    const settlementAccounting={scope:'last seven days of venue-reported settlements; finalized payout verification',records:[],refusals:[],accountCashReconciled:false};
    if(settlements.length>100)settlementAccounting.refusals.push({reason:'bounded-settlement-accounting-window-exceeded',count:settlements.length});
    else for(const settlement of settlements){
     try{const response=await client.getMarket(settlement.ticker);settlementAccounting.records.push(reconcileSettlementPayout({settlement,market:response.market??response,observedAt:new Date().toISOString()}));}
     catch(error){settlementAccounting.refusals.push({ticker:settlement.ticker,reason:error.message});}
    }
    value=await persist('kalshi',{type:'KalshiFleetAccountObservation',observedAt,balance,positions,orders,fills,settlements,settlementAccounting,mandatePolicyReadiness:readDeskAuthority({root:environment.KALSHI_DESK_AUTHORITY_ROOT??environment.METROPLAT_AUTHORITY_ROOT??environment.METROPLAT_REPOSITORY_ROOT,at:new Date().toISOString()}),orderEffect:false});
   }
   return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}};
  }catch(error){return {jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:error instanceof Error?error.message:String(error)}]}};}
 };
 return [{prefix:'fleet',description:'Joint fleet observations, unsigned Base preparation and custody-bound live Alpaca execution',client:createMcpClient({transport:mcpInProcessTransport(handle),clientInfo:{name:config.instance.name,version:'1.0.0'}})}];
}
