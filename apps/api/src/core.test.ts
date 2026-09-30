import test from 'node:test';
import assert from 'node:assert/strict';
import {webOriginsFor} from './core.js';

test('development accepts both local loopback browser origins',()=>{
  assert.deepEqual(webOriginsFor('http://localhost:5173',false),[
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ]);
  assert.deepEqual(webOriginsFor('http://127.0.0.1:5173',false),[
    'http://127.0.0.1:5173',
    'http://localhost:5173'
  ]);
});

test('production accepts only the explicitly configured origin',()=>{
  assert.deepEqual(webOriginsFor('https://sahana.example',true),['https://sahana.example']);
  assert.deepEqual(webOriginsFor('http://localhost:5173',true),['http://localhost:5173']);
});

test('development does not broaden non-loopback origins',()=>{
  assert.deepEqual(webOriginsFor('https://preview.sahana.example',false),['https://preview.sahana.example']);
});
