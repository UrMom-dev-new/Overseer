import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { allowedLocalRequest, trustedIpc, safeExternalUrl, localAppUrl, configureSession } = require('../electron/security.cjs');
const origin = 'http://127.0.0.1:45454';
const request = (headers = {}, url = '/api/sources') => ({ headers: { host: '127.0.0.1:45454', ...headers }, socket: { remoteAddress: '127.0.0.1' }, url });

test('local HTTP guard rejects DNS rebinding and cross-origin browser requests', () => {
  assert.equal(allowedLocalRequest(request(), 45454), true);
  assert.equal(allowedLocalRequest(request({ origin }), 45454), true);
  assert.equal(allowedLocalRequest(request({ host: 'localhost:45454' }), 45454), true);
  for (const headers of [{ host: 'attacker.example:45454' }, { host: '127.0.0.1:1234' },
    { origin: 'https://attacker.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal(allowedLocalRequest(request(headers), 45454), false);
  }
  assert.equal(allowedLocalRequest(request({}, '//attacker.example/api'), 45454), false);
  assert.equal(allowedLocalRequest(request({}, 'http://127.0.0.1:45454/api'), 45454), false);
  assert.equal(allowedLocalRequest({ ...request(), socket: { remoteAddress: '10.0.0.1' } }, 45454), false);
});

test('IPC requires the owning window, its main frame, and exact startup path or app origin', () => {
  const contents = { mainFrame: { url: `${origin}/` }, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const startup = 'file:///app/electron/startup.html';
  assert.equal(trustedIpc(event, contents, origin, startup), true);
  assert.equal(trustedIpc({ ...event, sender: {} }, contents, origin, startup), false);
  assert.equal(trustedIpc({ ...event, senderFrame: { url: `${origin}/` } }, contents, origin, startup), false);
  for (const url of ['https://attacker.example', 'file:///tmp/startup.html', 'file:///app/electron/startup.html?spoof=1']) {
    contents.mainFrame.url = url;
    assert.equal(trustedIpc(event, contents, origin, startup), false);
  }
  contents.mainFrame.url = startup;
  assert.equal(trustedIpc(event, contents, null, startup), true);
});

test('device permissions default to denied without prompting', () => {
  let check, request, device;
  configureSession({ setPermissionCheckHandler: fn => { check = fn; }, setPermissionRequestHandler: fn => { request = fn; }, setDevicePermissionHandler: fn => { device = fn; } });
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'usb', 'serial']) {
    assert.equal(check(null, permission, 'https://www.youtube.com'), false);
    request(null, permission, allowed => assert.equal(allowed, false));
  }
  assert.equal(device(), false);
});

test('development URLs stay on loopback; external links reject dangerous schemes and credentials', () => {
  assert.equal(localAppUrl(`${origin}/`), true);
  for (const url of ['https://example.com', 'http://127.0.0.1.evil.example', 'http://u:p@127.0.0.1:3000']) assert.equal(localAppUrl(url), false);
  for (const url of ['https://example.com/video', 'http://example.com', 'mailto:report@example.com']) assert.equal(safeExternalUrl(url), true);
  for (const url of ['file:///private', 'javascript:alert(1)', 'data:text/html,anything', 'https://u:p@example.com', 'https://example.com/\nsecret']) assert.equal(safeExternalUrl(url), false);
});

test('clipboard writes remain available only to the owning top-level app document', () => {
  const contents = {};
  let check, request;
  configureSession({ setPermissionCheckHandler: fn => { check = fn; }, setPermissionRequestHandler: fn => { request = fn; }, setDevicePermissionHandler: () => {} }, () => ({ contents, url: origin }));
  const details = { isMainFrame: true, requestingUrl: `${origin}/` };
  assert.equal(check(contents, 'clipboard-sanitized-write', origin, details), true);
  request(contents, 'clipboard-sanitized-write', result => assert.equal(result, true), details);
  for (const invalid of [{ ...details, isMainFrame: false }, { ...details, requestingUrl: 'https://www.youtube.com' }, {}]) {
    assert.equal(check(contents, 'clipboard-sanitized-write', origin, invalid), false);
  }
  assert.equal(check({}, 'clipboard-sanitized-write', origin, details), false);
  assert.equal(check(contents, 'clipboard-read', origin, details), false);
});
