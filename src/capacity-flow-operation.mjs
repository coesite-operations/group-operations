import { forecastKleinCapacityFlow } from "@red-cup-engineering/computer-system-platform/klein-capacity-flow";

/**
 * Operational receiving of a finite load-distribution forecast, without
 * conferring provider authority or custody of actual message files.
 *
 * Red Cup computes the reusable conservative flux; Coesite binds office,
 * existing Semioverse work, legal principal, scientific reference and
 * independently different receiver. LAGOON/Guix owns any later installed
 * code realization and source/target delivery receipts.
 */
const NI=/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const OFFICE=/^urn:ame:[a-z0-9][a-z0-9:-]*$/u;

export function assessOfficeCapacityIntervention({
  workRef, principal, operatingActor, receivingActor, mathematics,
  scenario, sourceEvidence,
}={}) {
  if(!NI.test(workRef??"")||!NI.test(sourceEvidence??"")||
     typeof principal!=="string"||!principal||
     !OFFICE.test(operatingActor??"")||!OFFICE.test(receivingActor??"")||
     operatingActor===receivingActor||
     mathematics!=="Obsmetrologia/Language/Positing/Gauge.lean")
    throw new TypeError("office-bound capacity flow needs existing work, K4 law and an independent receiver");
  const forecast=forecastKleinCapacityFlow(scenario);
  const transferCandidates=forecast.routed.transfers.map(({route,forecastWorkUnits})=>Object.freeze({
    route,forecastWorkUnits,
    executionAllowed:false,
    requires:["source-owned durable custody","receiving actor authorization",
      "provider-native eligible capacity","committed Guix/LAGOON release",
      "source deletion only after target receipt","independent result acceptance",
      "cost, licensing and egress evidence"],
  }));
  return Object.freeze({
    kind:"GroupOfficeCapacityInterventionForecast",
    workRef,principal,operatingActor,receivingActor,mathematics,sourceEvidence,
    forecast,transferCandidates,
    executionAllowed:false,sourceCustodyMutated:false,
    cloudEntitlementEstablished:false,accountingPosted:false,
    acceptance:"UNRECEIVED_FORECAST",
  });
}
