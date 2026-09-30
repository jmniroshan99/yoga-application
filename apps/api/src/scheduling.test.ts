import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canCancel,localBounds,nextBookingState} from './scheduling.js';

test('business date is converted to UTC without losing the Sri Lanka offset',()=>{
  const bounds=localBounds('2026-10-01','Asia/Colombo');
  assert.equal(bounds.start,'2026-09-30T18:30:00.000Z');
  assert.equal(bounds.end,'2026-10-01T18:30:00.000Z');
});
test('cancellation cutoff treats exact boundary as eligible',()=>{
  const now=Date.UTC(2026,8,28,0,0,0);
  assert.equal(canCancel(new Date(now+24*3600000),24,now),true);
  assert.equal(canCancel(new Date(now+24*3600000-1),24,now),false);
});
test('therapeutic requests wait for practitioner review',()=>{
  assert.equal(nextBookingState(true),'pending_review');
  assert.equal(nextBookingState(false),'pending_payment');
});
