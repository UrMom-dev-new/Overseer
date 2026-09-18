import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Test the smoke harness with a local process. This fixture never ships in the
// application and does not represent a live provider or renderer test.
const fixture = `
const {createServer} = require('node:http');
const {appendFileSync,mkdirSync} = require('node:fs');
const {join} = require('node:path');
const scenario = process.env.OVERSEER_TEST_SCENARIO;
if(scenario === 'early-exit') process.exit(0);
if(scenario === 'never-ready') setInterval(()=>{},1000);
else {
 const server = createServer((req,res)=>{
  if(req.url === '/') { res.setHeader('content-type','text/html'); res.end('<html>OVERSEER<script src="/_next/static/app.js"></script></html>'); }
  else if(req.url === '/_next/static/app.js') { res.statusCode=scenario==='missing-asset'?404:200; res.setHeader('content-type','application/javascript'); res.end('/* bundle */'); }
  else { res.setHeader('content-type','application/json'); res.end(JSON.stringify(req.url === '/api/health' ? {appId:scenario==='wrong-identity'?'other':'overseer',processStatus:'alive'} : {capabilities:[{id:'earthquakes'}]})); }
 });
 server.listen(0,'127.0.0.1',()=>{
  const folder=join(process.env.OVERSEER_DESKTOP_USER_DATA,'logs'); mkdirSync(folder,{recursive:true});
  const timestamp = new Date().toISOString();
  appendFileSync(join(folder,'overseer-desktop.log'),[
   {timestamp,message:'Local server listening on http://127.0.0.1:'+server.address().port},
   {timestamp,message:'dashboard interactive: Dashboard main frame loaded.'}
  ].map(JSON.stringify).join('\\n')+'\\n');
 });
}
`;

for (const [scenario, expectedCode, pattern] of [
  ['success', 0, null],
  ['stale-log', 0, null],
  ['missing-asset', 1, /HTTP 404/],
  ['wrong-identity', 1, /identity/],
  ['early-exit', 1, /exited before readiness/],
  ['never-ready', 1, /Timed out/],
]) {
  test(`desktop smoke harness: ${scenario}`, { skip: process.platform === 'win32' ? 'POSIX executable fixture; Windows CI tests the actual installed EXE.' : false }, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'overseer-smoke-harness-'));
    const binary = join(folder, 'fake-desktop');
    const userData = join(folder, 'profile');
    await writeFile(binary, `#!${process.execPath}\n${fixture}`, { mode: 0o700 });
    const env = { ...process.env, OVERSEER_DESKTOP_BINARY: binary, OVERSEER_TEST_SCENARIO: scenario,
      OVERSEER_DESKTOP_SMOKE_REPORT_DIR: folder, OVERSEER_DESKTOP_SMOKE_TIMEOUT_MS: '3000',
      OVERSEER_DESKTOP_RENDERER_CHECK: '0' };
    if (scenario === 'stale-log') {
      await mkdir(join(userData, 'logs'), { recursive: true });
      await writeFile(join(userData, 'logs', 'overseer-desktop.log'), [
        { timestamp: '2000-01-01T00:00:00.000Z', message: 'Local server listening on http://127.0.0.1:9.' },
        { timestamp: '2000-01-01T00:00:00.000Z', message: 'dashboard interactive: stale previous run.' },
      ].map(JSON.stringify).join('\n') + '\n');
      env.OVERSEER_DESKTOP_SMOKE_USER_DATA = userData;
    }
    const child = spawn(process.execPath, ['scripts/smoke-electron.mjs'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const code = await new Promise((resolve,reject)=>{ child.once('exit',resolve); child.once('error',reject); });
    assert.equal(code,expectedCode,output);
    const report=JSON.parse(await readFile(join(folder,'smoke.json'),'utf8'));
    assert.equal(report.passed, expectedCode === 0);
    if(pattern) assert.match(report.error,pattern);
    else { assert.equal(report.assetsChecked,1); assert.equal(report.capabilities,1); }
  });
}
