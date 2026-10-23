import assert from 'node:assert/strict';
import test from 'node:test';
import { FINANCIAL_FLEET_PULSE_JOB, selectFinancialFleetPulseDeployment } from '../src/financial-fleet-job-selection.mjs';

const observed = (names) => new Map(names.map(name => [name, { id: name }]));
const deployment = (name, names = []) => ({ deployment: name, jobConfiguration: { name, names } });
const jobsOf = ({ names }) => observed(names);
const admit = (...entries) => ({ law: 'original Coesite job law', deploymentRecords: entries });

test('one actual qualifying deployment selected, not the first or a machine-path guess', () => {
  const records = admit(deployment('education-production', ['youtube-production']), deployment('cold-red-gate-host', [FINANCIAL_FLEET_PULSE_JOB]), deployment('other', ['other']));
  assert.equal(selectFinancialFleetPulseDeployment(records, jobsOf), 'cold-red-gate-host');
  assert.equal(selectFinancialFleetPulseDeployment(admit(records.deploymentRecords[1], records.deploymentRecords[0]), jobsOf), 'cold-red-gate-host');
});

test('one deployment can contain many jobs without causing duplicate selection', () => {
  assert.equal(selectFinancialFleetPulseDeployment(admit(deployment('own', ['other-job', FINANCIAL_FLEET_PULSE_JOB, 'health'])), jobsOf), 'own');
});

test('no deployment, or two deployments declaring the same pulse, refuses', () => {
  assert.throws(() => selectFinancialFleetPulseDeployment(admit(deployment('other', ['youtube'])), jobsOf), /exactly one installed deployment \(found 0\)/);
  assert.throws(() => selectFinancialFleetPulseDeployment(admit(deployment('first', [FINANCIAL_FLEET_PULSE_JOB]), deployment('second', [FINANCIAL_FLEET_PULSE_JOB])), jobsOf), /exactly one installed deployment \(found 2\)/);
});

test('unknown installation, non-Code reader and Code provider exception fail closed', () => {
  assert.throws(() => selectFinancialFleetPulseDeployment(undefined, jobsOf), /admitted native deployments/);
  assert.throws(() => selectFinancialFleetPulseDeployment(admit(deployment('own', [FINANCIAL_FLEET_PULSE_JOB])), undefined), /admitted native deployments/);
  assert.throws(() => selectFinancialFleetPulseDeployment(admit(deployment('own', [FINANCIAL_FLEET_PULSE_JOB])), () => [FINANCIAL_FLEET_PULSE_JOB]), /original node-job declarations/);
  assert.throws(() => selectFinancialFleetPulseDeployment(admit(deployment('own', [FINANCIAL_FLEET_PULSE_JOB])), () => { throw new TypeError('native declarations unavailable'); }), /native declarations unavailable/);
});

test('selection observes declared jobs only and performs no execution', () => {
  let reads = 0;
  const records = admit(deployment('one', [FINANCIAL_FLEET_PULSE_JOB]));
  assert.equal(selectFinancialFleetPulseDeployment(records, configuration => { reads++; return jobsOf(configuration); }), 'one');
  assert.equal(reads, 1);
  assert.deepEqual(records, admit(deployment('one', [FINANCIAL_FLEET_PULSE_JOB])));
});
