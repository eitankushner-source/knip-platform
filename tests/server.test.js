import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../server.js';

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(chunk = '') { this.body += chunk; }
  };
}

test('health endpoint returns foundation version', async () => {
  const req = { method: 'GET', url: '/api/health', headers: { host: 'localhost' } };
  const res = mockResponse();
  await handleRequest(req, res);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.version, '0.1.0-alpha-foundation');
});

test('unknown API route returns 404', async () => {
  const req = { method: 'GET', url: '/api/not-real', headers: { host: 'localhost' } };
  const res = mockResponse();
  await handleRequest(req, res);
  assert.equal(res.statusCode, 404);
});
