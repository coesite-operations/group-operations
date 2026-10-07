import { createMcpClient, mcpInProcessTransport } from '@red-cup-engineering/mcp-engineering-services-section/client';
import { weatherEcmwfEvidence, weatherRoot, allocateLiveWeather, weatherEvidence, weatherIndexEvidence, weatherStationEvidence, weatherStationSkill, weatherStatus, triggerWeatherCycle, scoreWeather, admitWeatherModel } from '@red-cup-engineering/kalshi-services-section/weather-engine';
const empty={type:'object',properties:{},additionalProperties:false};
const money={type:'number',minimum:0,maximum:100000000};
export const weatherTools=[
 {name:'weather_ecmwf_evidence',description:'Collect a complete 51-member ECMWF AIFS ENS v2 2m-temperature ensemble at 1..4 future six-hour slots for verified NWS station coordinates. Retain indexed GRIB2 fields and their real receipt clocks; preserve member/site/time identities and four grid-corner projection witnesses. Publish experimental marginal laws in existing prospective station science. No interpolation, daily-extreme projection, venue admission or orders.',inputSchema:{type:'object',properties:{stations:{type:'array',minItems:1,maxItems:16,items:{type:'object',properties:{station:{type:'string',pattern:'^[A-Z0-9]{4}$'},timeZone:{type:'string'}},required:['station','timeZone'],additionalProperties:false}},validCount:{type:'integer',minimum:1,maximum:4}},required:['stations'],additionalProperties:false}},
 {name:'weather_status',description:'Read live Kalshi weather coverage, missing forecast capabilities, and settlement-scored model skill on Cold Red Gate.',inputSchema:empty},
 {name:'weather_cycle',description:'Start a persistent weather cycle on Cold Red Gate: discover live contracts, collect evidence, forecast and score. Returns immediately; weather_status reads progress and result. No orders.',inputSchema:empty},
 {name:'weather_forecast',description:'Read one contract: exact rules, source, each model probability, contradictory SignCell evidence and validation.',inputSchema:{type:'object',properties:{ticker:{type:'string',maxLength:120}},required:['ticker'],additionalProperties:false}},
 {name:'weather_evidence',description:'Read content-addressed raw station evidence from the persistent weather archive.',inputSchema:{type:'object',properties:{evidenceId:{type:'string',pattern:'^[a-f0-9]{64}$'},station:{type:'string',maxLength:32}},required:['evidenceId'],additionalProperties:false}},
 {name:'weather_station_evidence',description:'Collect and archive public NBM guidance/quantiles, NWS hourly forecasts/observations/hazards and available climate reports for station research. No Kalshi market is required. Returns scientific source records, not a trading judgment.',inputSchema:{type:'object',properties:{stations:{type:'array',minItems:1,maxItems:16,items:{type:'object',properties:{station:{type:'string',pattern:'^[A-Z0-9]{4}$'},timeZone:{type:'string'},targetDates:{type:'array',minItems:1,maxItems:4,items:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'}}},required:['station','timeZone'],additionalProperties:false}}},required:['stations'],additionalProperties:false}},
 {name:'weather_station_skill',description:'Read forward station or city-index forecast verification, with each truth source labeled: error in degrees F, approximate CRPS, coverage and learned bias/spread. Index keys are index:miami, index:nyc, index:chicago and index:la-coastal. Independent of venue binary eligibility.',inputSchema:{type:'object',properties:{station:{type:'string',pattern:'^(?:[A-Z0-9]{4}|index:(?:miami|nyc|chicago|la-coastal))$'}},additionalProperties:false}},
 {name:'weather_index_evidence',description:'Collect published city-index configuration, receipt-audited canonical minutes and constituent NWS/NBM/LAMP forecasts; archive and register forward physical verification without any market listing or trading order.',inputSchema:{type:'object',properties:{cities:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:{enum:['miami','nyc','chicago','la-coastal']}}},required:['cities'],additionalProperties:false}},
 {name:'weather_score',description:'Score pending forecasts against Kalshi settlements. Repeated observations do not increase independent sample counts.',inputSchema:empty},
 {name:'weather_allocate',description:'Reserve a cash budget once across validated weather opportunities using freshly reread quotes, measured depth and event/date caps. With no capital argument, reads signer-host weather-shard cash and resting-order commitments. Explicit capital supports scenarios. Quotes expire in 60 seconds; no orders.',inputSchema:{type:'object',properties:{capitalUsd:money,encumberedUsd:money},additionalProperties:false}},
 {name:'weather_model_admit',description:'Submit a versioned model experiment with source provenance and current issue/expiry. Forecasts must match exact live rulesHash; station ensembles carry daily high/low samples in Fahrenheit. Future settlements decide skill; submission never grants trade authority.',inputSchema:{type:'object',properties:{model:{type:'string'},version:{type:'string'},sourceUrl:{type:'string'},issuedAt:{type:'string'},validUntil:{type:'string'},forecasts:{type:'array',items:{type:'object',properties:{ticker:{type:'string'},rulesHash:{type:'string'},probability:{type:'number',minimum:0,maximum:1}},required:['ticker','rulesHash','probability'],additionalProperties:false}},ensembles:{type:'array',items:{type:'object',properties:{station:{type:'string'},targetDate:{type:'string'},kind:{enum:['high','low']},unit:{const:'F'},samples:{type:'array',minItems:10,maxItems:10000,items:{type:'number'}}},required:['station','targetDate','kind','unit','samples'],additionalProperties:false}}},required:['model','version','sourceUrl','issuedAt','validUntil'],additionalProperties:false}},
];
export function weatherNetworkSources({environment=process.env,config}) {
 const root=weatherRoot(environment);
 const handle=async m=>{
  const id=m?.id??null;
  if(!m||m.jsonrpc!=='2.0'||typeof m.method!=='string')return {jsonrpc:'2.0',id,error:{code:-32600,message:'invalid request'}};
  if(m.method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'561-weather',version:'1.0.0'}}};
  if(m.method==='ping')return {jsonrpc:'2.0',id,result:{}};
  if(m.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:weatherTools}};
  if(m.id===undefined)return;
  if(m.method!=='tools/call')return {jsonrpc:'2.0',id,error:{code:-32601,message:'method not found'}};
  try{
   const tool=weatherTools.find(t=>t.name===m.params?.name),args=m.params?.arguments??{};
   if(!tool||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(tool.inputSchema.properties,k))||(tool.inputSchema.required??[]).some(k=>args[k]===undefined))throw new TypeError('exact weather tool arguments required');
   let value;
   if(tool.name==='weather_ecmwf_evidence')value=await weatherEcmwfEvidence({root,...args});
   else if(tool.name==='weather_station_skill')value=await weatherStationSkill({root,...args});
   else if(tool.name==='weather_index_evidence')value=await weatherIndexEvidence({root,...args});
   else if(tool.name==='weather_station_evidence')value=await weatherStationEvidence({root,...args});
   else if(tool.name==='weather_evidence')value=await weatherEvidence({root,...args});
   else if(tool.name==='weather_cycle')value=await triggerWeatherCycle({root});
   else if(tool.name==='weather_score')value=await scoreWeather({root});
   else if(tool.name==='weather_model_admit')value=await admitWeatherModel(args,{root});
   else {
    const state=await weatherStatus({root});
    if(tool.name==='weather_forecast'){
     if(typeof args.ticker!=='string'||args.ticker.length>120)throw new TypeError('bounded ticker required');
     value={forecast:state.forecasts?.find(r=>r.ticker===args.ticker)??null,contract:state.contracts?.find(r=>r.ticker===args.ticker)??null};
    }else if(tool.name==='weather_allocate'){
     if(args.capitalUsd===undefined&&args.encumberedUsd!==undefined)throw new TypeError('encumberedUsd requires an explicit scenario capitalUsd');
     value=await allocateLiveWeather({root,...args});
    }else {const {forecasts,contracts,...summary}=state;value=summary;}
   }
   // Avoid sending the entire census to an agent after a cycle.
   if(tool.name==='weather_cycle'){const {forecasts,contracts,...summary}=value;value=summary;}
   value=JSON.parse(JSON.stringify(value));
   return {jsonrpc:'2.0',id,result:{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}};
  }catch(e){return {jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:e.message}]}};}
 };
 return [{prefix:'weather',description:'Live weather evidence, forecast experiments, settlement learning and capital plans',client:createMcpClient({transport:mcpInProcessTransport(handle),clientInfo:{name:config.instance.name,version:'1.0.0'}})}];
}
