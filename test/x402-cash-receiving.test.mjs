import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareOffer, offerRequestPricing } from '@red-cup-engineering/x402-services-section/offer';
import catalog from '@red-cup-engineering/x402-services-section/market-561-group/catalog' with { type: 'json' };
import { corroborateMarketSellerSettlements } from '@red-cup-engineering/x402-services-section/seller-settlements';
import { settlementWitnessGraphId } from '@red-cup-engineering/x402-services-section/x402-settlement-witness-identity';
import { outcomeJournal, outcomeOf, outcomeBookText, standingOf, partyResolverOf, acceptanceReadoutOf } from '@red-cup-engineering/organizing/enterprise';
import { createSemanticRecordJournal } from '@red-cup-engineering/semiotic-eavt-services-section/record-semantic-record';
import { writeSellerPaymentBooks } from '../src/seller-payment-books.mjs';
import { writeOutcomeBook } from '../src/acceptance.mjs';
import { currentGroupAcceptanceReadout, currentGroupFinancialReadout } from '../src/group-financial-readout-view.mjs';

const tx = `0x${'ab'.repeat(32)}`, block = `0x${'cd'.repeat(32)}`;
const payer = `0x${'12'.repeat(20)}`, receiver = `0x${'34'.repeat(20)}`;
const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const network = 'eip155:8453', at = '2026-10-08T00:00:00.000Z';
const topic = address => '0x' + '0'.repeat(24) + address.slice(2);
function fixture({ legacy = false, mismatch = false } = {}) {
  const declaration = structuredClone(catalog.find(row => row.method === 'POST'));
  declaration.seller = { enterprise: 'fixture-seller', entity: 'fixture-llc', record: { path: 'lib/fixture/lib/agency/enterprises/fixture-seller.json', sha256: 'a'.repeat(64) } };
  declaration.ledgerAccount = 'Income:Sales:X402';
  declaration.requestPricing = { mode: 'canonical-json-byte-bands', includedBytes: 4096, additionalUnitBytes: 4096, additionalUnitAtomic: '100', maximumAtomic: '9600' };
  declaration.price = '$0.0012';
  const offer = declareOffer(declaration), pricing = offerRequestPricing(declaration, { input: 'x'.repeat(5000) });
  const witness = { version: 2, network, transaction: tx, payer, payTo: receiver, asset, amount: pricing.amountAtomic, recordedAt: at,
    gateway: declaration.gateway, operation: declaration.operation, route: declaration.route, method: declaration.method, sku: offer.sku,
    offerDeclaration: declaration, ledgerAccount: declaration.ledgerAccount, seller: declaration.seller,
    book: { enterprise: declaration.seller.enterprise, account: declaration.ledgerAccount }, pricingBasis: pricing,
    quotedAmountAtomic: pricing.amountAtomic, witnessId: settlementWitnessGraphId({ network, transaction: tx }) };
  if (legacy) delete witness.offerDeclaration;
  if (mismatch) witness.book.enterprise = 'substituted-seller';
  const receipt = { transactionHash: tx, blockHash: block, blockNumber: '0x1', status: '0x1', logs: [{ address: asset,
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', topic(payer), topic(receiver)],
    data: '0x' + BigInt(pricing.amountAtomic).toString(16).padStart(64, '0'), logIndex: '0x0' }] };
  const client = { list: async () => ({ keys: [`settlements/${network}/${tx}.json`] }), get: async () => ({ body: Buffer.from(JSON.stringify(witness)) }) };
  const options = { environment: {}, client, now: () => new Date(at), readReceipt: async () => [receipt, structuredClone(receipt)],
    readBlockHeader: async () => [0, 1].map(() => ({ blockHash: block, blockNumber: '1', blockTimestamp: String(Date.parse(at) / 1000) })) };
  return { options, witness };
}

test('exact seller tariff survives two-provider cash receiving, private books and replay without income or customer acceptance', async () => {
  const { options } = fixture();
  const observation = await corroborateMarketSellerSettlements(options);
  assert.equal(observation.state, 'current'); assert.equal(observation.confirmedCount, 1);
  assert.equal(observation.attributionRefusedCount, 0);
  const cash = observation.settlements[0];
  assert.equal(cash.amount, '1300'); assert.equal(cash.seller.enterprise, 'fixture-seller');
  assert.equal(cash.book.account, 'Income:Sales:X402'); assert.equal(cash.requesterAccepted, null);
  const root = await mkdtemp(join(tmpdir(), 'native-cash-receiving-'));
  try {
    const result = await writeSellerPaymentBooks(root, observation);
    const path = result.books[0].path, bytes = await readFile(path, 'utf8');
    assert.match(bytes, /Assets:Held-By:X402-Custodian\s+0\.0013 USDC/);
    assert.match(bytes, /Liabilities:Pending:X402-Receipts\s+-0\.0013 USDC/);
    assert.doesNotMatch(bytes, /\n\s+Income:/);
    assert.equal(result.revenueRecognized, false); assert.equal(result.enterpriseReceiving, 'unobserved');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await writeSellerPaymentBooks(root, observation); assert.equal(await readFile(path, 'utf8'), bytes);
    const held = await writeSellerPaymentBooks(root, { ...observation, state: 'unavailable', settlements: [] });
    assert.equal(held.state, 'held'); assert.equal(await readFile(path, 'utf8'), bytes);
    assert.equal(outcomeJournal(root).read().length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing old snapshots and substituted books retain independently corroborated cash without catalogue attribution', async () => {
  for (const settings of [{ legacy: true }, { mismatch: true }]) {
    const result = await corroborateMarketSellerSettlements(fixture(settings).options);
    assert.equal(result.state, 'current'); assert.equal(result.confirmedCount, 1); assert.equal(result.attributionRefusedCount, 1);
    assert.equal(result.settlements[0].seller, null); assert.equal(result.settlements[0].book, null);
    assert.equal(result.settlements[0].attribution, 'unresolved'); assert.equal(result.settlements[0].paymentConfirmed, true);
  }
});

test('historic payment claims remain readable but leave standing, acceptance and the derived income book; authored ledger stays intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-cash-history-'));
  try {
    const real = outcomeOf({ source: 'customer', lot: 'fixture', delivery: 'fixture-delivery', provider: 'seller', judge: 'receiver', verdict: 'accepted', at,
      evidence: ['fixture-receiver-judgment'], carrier: 'fixture-carrier' });
    const old = { ...real, id: 'historic-payment-claim', source: 'x402-settlement', value: { amount: '0.01', currency: 'USDC', basis: 'price', account: 'Income:Sales:X402' } };
    createSemanticRecordJournal({ root, objectKind: 'work-outcome' }).record({ category: 'x402-settlement', recordedAt: at, record: old, told: { for: true, against: false } });
    const journal = outcomeJournal(root); assert.deepEqual(journal.read(), [old]);
    assert.throws(() => outcomeOf(old), /payment is not a judgment/); assert.throws(() => journal.record(old), /cannot be recorded/);
    assert.deepEqual([...standingOf(journal.read())], []);
    const partyOf = partyResolverOf({ accounts: new Map([['seller', { entity: '561-group-llc' }]]) });
    const readout = acceptanceReadoutOf(journal.read(), { from: '2000-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z', partyOf });
    assert.equal(readout.border.external.count, 0); assert.doesNotMatch(outcomeBookText(journal.read(), { partyOf }), /Income:Sales:X402/);
    const ledger = join(root, 'authored.beancount'), authored = '; original authored bytes remain untouched\n'; await writeFile(ledger, authored);
    const projection = await writeOutcomeBook(join(root, 'web'), journal.read(), partyOf, { ledgerPath: ledger });
    assert.doesNotMatch(await readFile(projection, 'utf8'), /Income:Sales:X402/); assert.equal(await readFile(ledger, 'utf8'), authored);
    assert.deepEqual(journal.read(), [old]);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('human financial and acceptance receiving holds cached payment-derived aggregates until truthful projections arrive', async () => {
 const root=await mkdtemp(join(tmpdir(),'native-cash-readout-'));
 try {
  const config={dataDir:root,publicBaseUrl:'https://fixture.test'},authorActor='https://fixture.test/actors/owner';
  await mkdir(join(root,'records','group-financial'),{recursive:true});
  const financial={type:'GroupFinancialReadout',version:1,asOf:at,observations:[{kind:'x402-settlements',outcomeCount:26}]};
  const path=join(root,'records','group-financial','2026-10-08-group-financial-readout.json');await writeFile(path,JSON.stringify(financial));
  assert.equal(currentGroupFinancialReadout({config,authorActor}),null);
  await writeFile(path,JSON.stringify({...financial,version:2,observations:[{kind:'x402-settlements',outcomeCount:0,customerAcceptance:'unobserved'}]}));
  assert.equal(currentGroupFinancialReadout({config,authorActor}).observations[0].outcomeCount,0);
  await mkdir(join(root,'records','acceptance'),{recursive:true});const acceptancePath=join(root,'records','acceptance','2026-W41-to-date-acceptance-readout.json');
  const acceptance={type:'GroupAcceptanceReadout',week:'2026-W41',asOf:at,journal:{outcomes:26}};await writeFile(acceptancePath,JSON.stringify(acceptance));
  assert.equal(currentGroupAcceptanceReadout(root),null);
  await writeFile(acceptancePath,JSON.stringify({...acceptance,journal:{outcomes:0,excluded:['x402-settlement']}}));
  assert.equal(currentGroupAcceptanceReadout(root).weekToDate.journal.outcomes,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
