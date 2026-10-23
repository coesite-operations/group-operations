/**
 * Project the sole deployment capable of this already-declared Group job.
 * The Systems node-job provider admits all installation records and the Code
 * provider reads each declaration; this function does not admit or run jobs.
 * It never defaults to a host, a release path, or the first array element.
 */
export const FINANCIAL_FLEET_PULSE_JOB = 'financial-fleet-pulse';

export function selectFinancialFleetPulseDeployment(admitted, jobsForConfiguration) {
  if (!Array.isArray(admitted?.deploymentRecords) || typeof jobsForConfiguration !== 'function') {
    throw new TypeError('financial-fleet-pulse requires admitted native deployments and job reader');
  }
  const eligible = [];
  for (const entry of admitted.deploymentRecords) {
    const jobs = jobsForConfiguration(entry.jobConfiguration);
    if (!(jobs instanceof Map)) throw new TypeError('financial-fleet-pulse requires original node-job declarations');
    if (jobs.has(FINANCIAL_FLEET_PULSE_JOB)) eligible.push(entry.deployment);
  }
  if (eligible.length !== 1) {
    throw new TypeError(`financial-fleet-pulse requires exactly one installed deployment (found ${eligible.length})`);
  }
  return eligible[0];
}
