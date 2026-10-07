import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseJournalText } from '@red-cup-engineering/farolfi/journal';
import { movementClassesOverWindow } from '../src/chain-classification.mjs';
import { chainMovementBookText } from '../src/reconciliation.mjs';
import { composeGroupFinancialReadout } from '../src/group-financial-readout.mjs';

test('source refusals survive classified movements, the Beancount artifact, and the Board readout', async () => {
  const detail = { kind: 'unrecognized-operation', payload: { amount: '9007199254740993.001', memo: 'unclassified resource' } };
  const coverage = { status: 'unresolved', unresolved: [{ source: 'hive-history', detail }] };
  const evidence = { type: 'HiveAccountLedgerEvidence', coverage, hiveHistory: { operations: [detail] } };
  const record = await movementClassesOverWindow({ wallets: [{ publicAccount: 'example' }], from: '2026-10-01', to: '2026-10-02' }, {
    deriveLedgerForAccount: async () => ({ ledgerResult: { ledgerText: '' }, coverage, evidence }),
  });
  assert.deepEqual(record.observations[0].evidence, evidence);
  assert.equal(record.coverage.unresolved[0].account, 'example');
  const book = chainMovementBookText({ entries: [] }, { sourceRecords: [record] });
  const retained = JSON.parse(book.split('\n').find((line) => line.startsWith('; chain-movement-evidence ')).slice('; chain-movement-evidence '.length));
  assert.deepEqual(retained.observations[0].evidence, evidence);
  assert.equal(parseJournalText(book).entries.length, 0);
  const readout = composeGroupFinancialReadout({
    asOf: '2026-10-02T12:00:00.000Z', ledgerObservation: { observedAt: '2026-10-02T12:00:00.000Z' }, walletRegistry: { derivedAt: '2026-10-02T12:00:00.000Z', wallets: [] },
    chainReconciliation: { cutoff: '2026-10-01', rows: [{ state: 'agrees' }], failed: 0, sourceCoverage: record.coverage, sourceEvidencePath: 'source.json' },
  });
  assert.ok(readout.unresolved.some((line) => line.includes('source coverage is unresolved')));
  assert.deepEqual(readout.observations.find((row) => row.kind === 'chain-reconciliation').sourceCoverage, record.coverage);
});

test('failed accounts remain unresolved; older derivations never imply full coverage', async () => {
  const record = await movementClassesOverWindow({ wallets: [{ publicAccount: 'available' }, { publicAccount: 'unavailable' }], from: '2026-10-01', to: '2026-10-02' }, {
    deriveLedgerForAccount: async ({ account }) => { if (account === 'unavailable') throw new Error('history unavailable'); return { ledgerResult: { ledgerText: '' } }; },
  });
  assert.equal(record.coverage.status, 'unresolved');
  assert.equal(record.observations[0].coverage.status, 'not-established');
  assert.equal(record.coverage.unresolved[0].account, 'unavailable');
});

test('the reconciliation job delivers its account observations into the movement book and daily record', async () => {
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { reconcileBooksWithChain } = await import('../src/reconciliation.mjs');
  const root = await mkdtemp(join(tmpdir(), 'hive-reconciliation-evidence-'));
  try {
    const ledgerPath = join(root, 'books.beancount'), movementBook = join(root, 'movements.beancount');
    await writeFile(ledgerPath, '2026-09-30 open Assets:Digital-Assets:Hive:Liquid\n2026-10-01 balance Assets:Digital-Assets:Hive:Liquid 0 HIVE\n');
    const detail = { unsupported: 'resource', amount: '9007199254740993.001' };
    const coverage = { status: 'unresolved', unresolved: [{ source: 'ledger-derivation', detail }] };
    const evidence = { type: 'HiveAccountLedgerEvidence', coverage, hiveHistory: { operations: [detail] } };
    const result = await reconcileBooksWithChain({ ledgerPath, movementBook, readingsDirectory: root, cutoff: '2026-10-01' }, {
      deriveChainBalanceAssertions: async ({ out }) => { const directives = ['2026-10-02 balance Assets:Digital-Assets:Hive:Liquid 0 HIVE']; await writeFile(out, directives[0]); return { directives }; },
      parseJournalFile: (file) => parseJournalText(readFileSync(file, 'utf8')),
      hiveCustodyWallets: () => [{ publicAccount: 'example' }], hiveAccounts: ['Assets:Digital-Assets:Hive:Liquid'],
      movementClassesOverWindow,
      deriveLedgerForAccount: async () => ({ ledgerResult: { ledgerText: '' }, coverage, evidence }),
    });
    assert.equal(result.sourceCoverage.status, 'unresolved');
    const delivered = await readFile(movementBook, 'utf8');
    assert.ok(delivered.includes('9007199254740993.001'));
    assert.deepEqual(parseJournalText(delivered).entries.filter((entry) => entry.postings), []);
    const saved = JSON.parse(await readFile(join(root, '2026-10-01-chain-reconciliation.json'), 'utf8'));
    assert.deepEqual(saved.sourceCoverage, result.sourceCoverage);
    const sources = JSON.parse(await readFile(saved.sourceEvidencePath, 'utf8'));
    assert.deepEqual(sources.observations[0].evidence, evidence);
  } finally { await rm(root, { recursive: true, force: true }); }
});
