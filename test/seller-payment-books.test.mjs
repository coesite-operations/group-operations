import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeSellerPaymentBooks } from "../src/seller-payment-books.mjs";

const settlement = (n) => Object.freeze({
  sourceId: `evm:eip155:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:0x${"34".repeat(20)}:0x${String(n).repeat(64).slice(0, 64)}:0`,
  transactionHash: `0x${String(n).repeat(64).slice(0, 64)}`, logIndex: "0", network: "eip155:8453",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payer: `0x${"12".repeat(20)}`, receiver: `0x${"34".repeat(20)}`,
  amount: "51", amountUsdc: "0.000051", blockTime: `2026-09-2${n}T12:00:00.000Z`, sku: "sku", paymentConfirmed: true,
  seller: null, book: null, attribution: "unresolved", attributionReason: "commercial-seller-unresolved",
  evidenceId: "evm:eip155:8453:tx", witnessId: "urn:x402:settlement",
});

test("a partial read projects every settlement the journal holds; without the journal it holds the books", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "seller-payment-books-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const partial = { state: "partially-corroborated", refusedCount: 1, settlements: [settlement(2)] };
  assert.equal((await writeSellerPaymentBooks(root, partial)).state, "held");
  const written = await writeSellerPaymentBooks(root, partial, { held: [settlement(1), settlement(2)] });
  assert.equal(written.state, "projected");
  assert.equal(written.books[0].transfers, 2);
  assert.match(readFileSync(written.books[0].path, "utf8"), /2026-09-21[\s\S]*2026-09-22/u);
  assert.equal(written.revenueRecognized, false);
});
