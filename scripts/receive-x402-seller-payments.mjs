#!/usr/bin/env node
// Native Coesite receiving: Red Cup independently corroborates private R2
// witnesses against Base, and the existing semantic journal retains only
// qualified, dated evidence. This does not book enterprise income or deliver
// a customer's purchase. The Group financial readout reads the retained
// result separately; it never invokes this receiving operation itself.
import { corroborateMarketSellerSettlements } from "@red-cup-engineering/x402-services-section/seller-settlements";
import { recordQualifiedSellerPaymentObservation } from "../src/seller-payment-books.mjs";

export async function receiveX402SellerPayments({
  environment = process.env,
  now = () => new Date(),
  corroborate = corroborateMarketSellerSettlements,
} = {}) {
  const privateData = environment.METROPLAT_DATA_ROOT;
  if (typeof privateData !== "string" || privateData.trim() === "") {
    throw new TypeError("METROPLAT_DATA_ROOT is required for native seller receiving");
  }
  const corroboration = await corroborate({ environment, now });
  const receipt = recordQualifiedSellerPaymentObservation(privateData, corroboration);
  return Object.freeze({
    kind: "561-group.x402-seller-payment-receiving",
    state: receipt.state, evidence: receipt.id ?? null,
    observedAt: receipt.observedAt ?? corroboration.observedAt ?? null,
    confirmedCount: receipt.confirmedCount ?? null,
    reason: receipt.reason ?? null, revenueRecognized: false,
    customerAcceptance: "unobserved",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await receiveX402SellerPayments();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.state !== "recorded") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`receive-x402-seller-payments: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
