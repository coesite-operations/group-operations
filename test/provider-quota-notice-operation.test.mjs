import test from 'node:test';
import assert from 'node:assert/strict';
import { bindProviderQuotaNoticeOperation } from '../src/provider-quota-notice-operation.mjs';

test('quota operation rejects an incomplete template', () => {
  assert.throws(() => bindProviderQuotaNoticeOperation({}, {}), /incomplete quota operation/);
});
