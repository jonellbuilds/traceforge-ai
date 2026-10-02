import test from 'node:test';
import assert from 'node:assert/strict';
import {median,robustZ,detect} from '../lib/anomaly.mjs';

test('median handles odd/even',()=>{
  assert.equal(median([3,1,2]),2);
  assert.equal(median([1,2,3,4]),2.5);
});

test('robust z catches extreme value',()=>{
  assert.ok(robustZ(100,[10,11,9,10,12,8],1).z>20);
});

test('detector flags latency spike',()=>{
  const s=Array.from({length:20},(_,i)=>({
    bucket:String(i),
    latency:i===19?900:100+(i%2),
    errors:.01,
    tokens:500,
    cost:.1
  }));
  assert.equal(detect(s,{window:12}).some(x=>x.metric==='latency'),true);
});
