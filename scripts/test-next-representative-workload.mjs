import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function client() {
  assert.equal(process.env.STOR24_NEXT_WORKLOAD_TEST, 'isolated-container');
  assert.match(process.env.WORKLOAD_PROJECT ?? '', /^stor24-next-workload-[a-f0-9]{12}$/);
  assert.match(process.env.WORKLOAD_SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  const seed = JSON.parse(readFileSync('/workload-evidence/seed.json', 'utf8'));
  assert.equal(seed.project, process.env.WORKLOAD_PROJECT);
  assert.equal(seed.sourceSha, process.env.WORKLOAD_SOURCE_SHA);
  const origin = 'http://127.0.0.1:3000', sessions = [], timings = {}, phases = [];
  const evidence = {
    sourceSha: seed.sourceSha, verifiedAt: new Date().toISOString(), result: 'INCOMPLETE',
    scope: 'Isolated production Next.js server/proxy/real cookie and permission guards, synthetic accounts and forwarded-IP fixtures. Not human/browser login, socket/proxy address security, physical devices, production peak or financial-contention clearance.',
    initial: { customers: 180, tenancies: 150, units: 210, notes: 540, communications: 180, staff: 25 },
    authentication: { boundary: 'normal login API; no session factory, JWT minting or MFA change', forwardedIpHeaders: 'explicit synthetic fixture inputs only' },
    thresholds: { readP95Ms: 5000, writeP95Ms: 8000, maximumMs: 15000 }, phases,
  };
  const saveEvidence = () => writeFileSync('/workload-evidence/http-result.json', JSON.stringify(evidence, null, 2));
  saveEvidence();
  const read = async (response, kind = 'json') => {
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length < 4 * 1024 * 1024, 'BOUNDED_FIXTURE_RESPONSE');
    return kind === 'bytes' ? bytes : kind === 'html' ? bytes.toString('utf8') : JSON.parse(bytes.toString('utf8'));
  };
  const request = async (index, path, body, name, kind = 'json') => {
    const before = performance.now();
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { origin, ...(index >= 0 ? { cookie: sessions[index] } : { cookie: 'stor24_session=invalid' }), 'x-forwarded-for': `127.0.0.${index + 2}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000),
    });
    const payload = await read(response, kind);
    if (name) (timings[name] ??= []).push(performance.now() - before);
    return { status: response.status, payload, headers: response.headers };
  };
  const login = async index => {
    // Synthetic-only credentials to same-container loopback; isolated project/DB guards above. Real HTTPS/browser acceptance is excluded.
    // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    const response = await fetch(origin + '/api/auth/login', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': `127.0.0.${index + 2}` },
      body: JSON.stringify({ email: seed.users[index].email, password: process.env.WORKLOAD_STAFF_PASSWORD }), signal: AbortSignal.timeout(30000),
    });
    await response.body?.cancel();
    return response;
  };
  try {
    for (let i = 0; i < 25; i++) {
      const response = await login(i); assert.equal(response.status, 200);
      const header = response.headers.get('set-cookie') ?? '';
      assert.ok(/stor24_session=/.test(header) && /HttpOnly/i.test(header) && /Secure/i.test(header) && /SameSite=lax/i.test(header), 'REAL_PRODUCTION_SESSION_COOKIE_REQUIRED');
      sessions.push(header.split(';')[0]); //Memory only; never logged or persisted.
    }
    for (let i = 0; i < 4; i++) assert.equal((await login(0)).status, 200);
    assert.equal((await login(0)).status, 429); //The original 5/IP window stays unchanged.
    evidence.authentication.successes = 29;
    evidence.authentication.sameIpSixthStatus = 429;
    const guide = await request(0, '/api/v1/operations/staff-guide', undefined, undefined, 'bytes');
    assert.equal(guide.status, 200); assert.ok(/application\/pdf/.test(guide.headers.get('content-type') ?? ''));
    assert.ok(/no-store/.test(guide.headers.get('cache-control') ?? '')); assert.equal(guide.payload.subarray(0, 4).toString(), '%PDF');
    const deviceId = randomUUID();
    const snapshot = await request(0, `/api/v1/offline/snapshot?facilityId=${seed.store}&deviceId=${deviceId}&deviceLabel=Synthetic-Next-fixture`);
    assert.equal(snapshot.status, 200); assert.equal(snapshot.payload.data.units.length, 210);
    assert.equal(Date.parse(snapshot.payload.data.expiresAt) - Date.parse(snapshot.payload.data.generatedAt), 12 * 60 * 60 * 1000);
    assert.ok(!JSON.stringify(snapshot.payload).includes('PRIVATE-OTHER-STORE'));
    assert.equal((await request(0, `/api/v1/offline/snapshot?facilityId=${seed.foreign}&deviceId=${deviceId}`)).status, 403);
    let bookingIndex = 150;
    const measurementStarted = performance.now();
    for (const concurrent of [5, 15, 25]) {
      const started = performance.now();
      await Promise.all(Array.from({ length: concurrent }, async (_, i) => {
        const page = await request(i, '/tenants', undefined, 'document', 'html');
        assert.equal(page.status, 200); assert.ok(/text\/html/.test(page.headers.get('content-type') ?? ''));
        assert.ok(/Customers.{0,12}tenants/.test(page.payload));
        const search = await request(i, '/api/v1/operations/followups?search=Synthetic', undefined, 'search');
        assert.equal(search.status, 200); assert.equal(search.payload.data.customers.length, 20); assert.ok(!JSON.stringify(search.payload).includes('PRIVATE-OTHER-STORE'));
        const history = await request(i, `/api/v1/customers/${seed.customers[i]}/history`, undefined, 'history');
        assert.equal(history.status, 200); assert.ok(history.payload.data.entries.length >= 4);
        assert.ok(history.payload.data.entries.every(entry => entry.kind !== 'ACCOUNT'));
        const note = { facilityId: seed.store, requestKey: randomUUID(), category: 'HANDOVER', body: `Synthetic Next note ${concurrent}-${i}` };
        const saved = await request(i, `/api/v1/customers/${seed.customers[i]}/history`, note, 'note'); assert.equal(saved.status, 200);
        const retry = await request(i, `/api/v1/customers/${seed.customers[i]}/history`, note, 'noteRetry');
        assert.equal(retry.status, 200); assert.equal(retry.payload.data.id, saved.payload.data.id);
        const report = await request(i, `/api/v1/reports/preview?reportKey=unit-availability&from=2026-10-01&to=2026-10-31&facilityId=${seed.store}`, undefined, 'report');
        assert.equal(report.status, 200); assert.equal(report.payload.data.length, 210);
        const booking = await request(i, '/api/v1/leasing/reservations', { facilityId: seed.store, customerId: seed.customers[150 + i % 30], unitId: seed.units[bookingIndex++], quotedRate: 100 }, 'booking');
        assert.equal(booking.status, 201);
      }));
      phases.push({ concurrent, businessRequests: concurrent * 6, documentRequests: concurrent, elapsedMs: performance.now() - started, unexpectedErrors: 0 });
      saveEvidence();
    }
    evidence.measurementMs = performance.now() - measurementStarted;
    assert.ok(evidence.measurementMs < 120000, 'BOUNDED_MEASUREMENT_WINDOW');
    assert.equal((await request(-1, `/api/v1/customers/${seed.customers[0]}/history`)).status, 401);
    assert.equal((await request(0, `/api/v1/customers/${seed.hidden}/history`)).status, 403);
    assert.equal((await request(0, `/api/v1/customers/${seed.customers[0]}/history`, { facilityId: seed.foreign, requestKey: randomUUID(), category: 'HANDOVER', body: 'Forbidden store' })).status, 403);
    assert.equal((await request(0, '/api/v1/leasing/reservations', {})).status, 422);
    assert.equal((await request(0, '/api/v1/leasing/reservations', { facilityId: seed.store, customerId: seed.customers[0], unitId: seed.units[150], quotedRate: 100 })).status, 409);
    assert.equal((await request(0, `/api/v1/customers/${seed.customers[0]}/history`)).status, 200);
    const leadSubmissionId = randomUUID();
    const captured = { submissionId: leadSubmissionId, deviceId, capturedAt: new Date().toISOString(), firstName: 'Synthetic', lastName: 'Offline fixture', phone: '+27000000000', facilityId: seed.store, consentToContact: true, communicationConsent: { email: false, sms: false, whatsapp: false } };
    const lead = await request(0, '/api/v1/offline/leads', captured); assert.equal(lead.status, 201);
    const leadRetry = await request(0, '/api/v1/offline/leads', captured); assert.equal(leadRetry.status, 200); assert.equal(leadRetry.payload.data.leadId, lead.payload.data.leadId);
    const offline = { submissionId: randomUUID(), leadSubmissionId, deviceId, capturedAt: captured.capturedAt, facilityId: seed.store, customerId: lead.payload.data.customerId, leadId: lead.payload.data.leadId, unitId: seed.units[150], quotedRate: 100, paymentMethod: 'UNDECIDED' };
    assert.equal((await request(0, '/api/v1/offline/reservations', offline)).status, 409);
    offline.unitId = seed.units[195];
    const synced = await request(0, '/api/v1/offline/reservations', offline); assert.equal(synced.status, 201);
    const syncedRetry = await request(0, '/api/v1/offline/reservations', offline); assert.equal(syncedRetry.status, 200); assert.equal(syncedRetry.payload.data.reservationId, synced.payload.data.reservationId);
    assert.ok(synced.payload.data.communications.every(item => item.status === 'NOT_CONSENTED'));
    const revision = await request(0, `/api/v1/offline/snapshot?facilityId=${seed.store}&check=1`);
    assert.equal(revision.status, 200); assert.notEqual(revision.payload.data.revision, snapshot.payload.data.revision);
    evidence.operations = Object.fromEntries(Object.entries(timings).map(([name, values]) => {
      values.sort((a, b) => a - b);
      const p95Ms = values[Math.ceil(values.length * .95) - 1], maxMs = values.at(-1);
      assert.ok(p95Ms < (['note', 'noteRetry', 'booking'].includes(name) ? 8000 : 5000), `LATENCY_THRESHOLD_${name}`);
      assert.ok(maxMs < 15000, `MAXIMUM_THRESHOLD_${name}`);
      return [name, { requests: values.length, p50Ms: values[Math.floor(values.length * .5)], p95Ms, maxMs, unexpectedErrors: 0 }];
    }));
    evidence.negativeChecks = { invalidSession: 401, foreignCustomer: 403, foreignNoteStore: 403, invalidBooking: 422, bookedUnit: 409, recovery: 200, sameIpSixthLogin: 429, safeNoteRetries: 45 };
    evidence.offline = { authorisedSnapshot: true, expiryHours: 12, leadSafeRetry: true, staleUnitConflict: true, reselectedBookingSafeRetry: true, sourceRevisionChanges: true, actualDeviceOrOfflineBrowserUat: false };
    evidence.result = 'PASS';
  } catch (error) {
    evidence.result = 'FAIL'; evidence.errorCode = /^[A-Z_0-9]+$/.test(error.code ?? '') ? error.code : 'ISOLATED_WORKLOAD_FAILED';
    process.exitCode = 1;
  } finally {
    saveEvidence();
    sessions.fill('');
    console.log(JSON.stringify({ result: evidence.result, phasesCompleted: phases.length, sourceSha: seed.sourceSha }));
  }
}

function host() {
  assert.equal(process.env.STOR24_NEXT_WORKLOAD_EXECUTION, 'approved-isolated', 'EXPLICIT_REVIEW_AND_CPU_SLOT_REQUIRED');
  const sha = process.argv[process.argv.indexOf('--source') + 1];
  assert.match(sha ?? '', /^[a-f0-9]{40}$/);
  const commandEnv = Object.fromEntries(['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const run = randomBytes(6).toString('hex'), project = `stor24-next-workload-${run}`;
  const directory = resolve('output', 'next-workload', run), clean = join(directory, 'source');
  assert.ok(directory.startsWith(resolve('output', 'next-workload') + (process.platform === 'win32' ? '\\' : '/')));
  mkdirSync(clean, { recursive: true });
  const manifest = { sourceSha: sha, project, result: 'INCOMPLETE', startedAt: new Date().toISOString(), phases: [], cleanup: 'Pending; no owned Compose service has been started.' };
  const saveManifest = () => writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  saveManifest();
  let dockerContext, compose, servicesStarted = false;
  const command = (phase, exe, args, timeout = 120000, cwd = clean) => {
    const started = performance.now();
    const privateOutput = ['container-inspect', 'resolved-compose', 'docker-endpoint'].includes(phase);
    try {
      const result = spawnSync(exe, args, { cwd, env: commandEnv, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      if (result.error || result.status !== 0) throw result;
      const output = result.stdout;
      writeFileSync(join(directory, `${phase}.log`), privateOutput ? 'PRIVATE_OUTPUT_NOT_RETAINED\n' : output + '\n' + result.stderr);
      manifest.phases.push({ phase, exitStatus: 0, elapsedMs: performance.now() - started });
      saveManifest();
      return output;
    } catch (error) {
      writeFileSync(join(directory, `${phase}.log`), privateOutput ? 'PRIVATE_OUTPUT_NOT_RETAINED\n' : `${error.stdout ?? ''}\n${error.stderr ?? ''}`);
      const text = String(error.stderr ?? '');
      const diagnosticClass = /unknown command: docker compose/i.test(text) ? 'COMPOSE_PLUGIN_UNAVAILABLE'
        : /permission denied|access is denied|EACCES/i.test(text) ? 'PROCESS_PERMISSION_DENIED'
        : /cannot connect|error during connect|is the docker daemon/i.test(text) ? 'DOCKER_ENGINE_UNAVAILABLE'
        : /yaml:|interpolation|invalid compose/i.test(text) ? 'COMPOSE_CONFIGURATION_REVIEW'
        : 'PROCESS_FAILURE_UNCLASSIFIED';
      const errorCode = /^[A-Z_0-9]+$/.test(error.error?.code ?? '') ? error.error.code : null;
      manifest.phases.push({ phase, exitStatus: error.status ?? 'INTERRUPTED', diagnosticClass, errorCode, elapsedMs: performance.now() - started });
      saveManifest();
      throw new Error(`ISOLATED_PHASE_FAILED_${phase}`);
    }
  };
  const docker = (phase, args, timeout) => command(phase, 'docker', ['--context', dockerContext, ...args], timeout);
  const dc = (phase, args, timeout) => docker(phase, [...compose, ...args], timeout);
  const inspectContainers = (checkState = true) => {
    const ids = dc('owned-ids', ['ps', '-aq']).trim().split(/\s+/).filter(Boolean);
    assert.ok(ids.every(id => /^[a-f0-9]{12,64}$/.test(id)));
    if (!ids.length) return [];
    const info = JSON.parse(docker('container-inspect', ['inspect', ...ids]));
    for (const item of info) {
      assert.equal(item.Config.Labels['com.docker.compose.project'], project);
      if (checkState) { assert.equal(item.RestartCount, 0); assert.equal(item.State.OOMKilled, false); }
      assert.equal(item.HostConfig.NanoCpus, 1000000000);
      assert.equal(item.HostConfig.Memory, 1073741824);
      assert.equal(item.HostConfig.PidsLimit, 256);
      if (item.Config.Labels['com.docker.compose.service'] === 'app') assert.equal(item.Config.Labels['org.opencontainers.image.revision'], sha);
      assert.ok(!Object.keys(item.HostConfig.PortBindings ?? {}).length);
      assert.deepEqual(Object.keys(item.NetworkSettings.Networks), [`${project}_isolated`]);
    }
    //Never retain raw environment/inspect values in logs or published evidence.
    writeFileSync(join(directory, 'container-inspect.log'), 'RAW_INSPECTION_DISCARDED\n');
    manifest.containers = info.map(item => ({ id: item.Id, image: item.Image, service: item.Config.Labels['com.docker.compose.service'], state: item.State.Status, oom: item.State.OOMKilled, restartCount: item.RestartCount, nanoCpus: item.HostConfig.NanoCpus, memory: item.HostConfig.Memory, pidsLimit: item.HostConfig.PidsLimit }));
    saveManifest();
    return info;
  };
  const waitHealthy = async service => {
    for (let n = 0; n < 60; n++) {
      const items = inspectContainers(), item = items.find(x => x.Config.Labels['com.docker.compose.service'] === service);
      if (item?.State.Health?.Status === 'healthy') return;
      assert.notEqual(item?.State.Status, 'exited', 'OWNED_SERVICE_EXITED');
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('OWNED_SERVICE_HEALTH_TIMEOUT');
  };
  return (async () => {
    try {
      assert.equal(command('source-head', 'git', ['rev-parse', 'HEAD'], 20000, process.cwd()).trim(), sha);
      command('source-clean', 'git', ['diff', '--quiet', 'HEAD'], 20000, process.cwd());
      command('source-tracked', 'git', ['ls-files', '--error-unmatch', 'compose.workload.yml', 'scripts/seed-next-workload.ts', 'scripts/test-next-representative-workload.mjs'], 20000, process.cwd());
      dockerContext = command('docker-context', 'docker', ['context', 'show'], 20000).trim();
      assert.match(dockerContext, /^[a-zA-Z0-9_-]+$/);
      const endpoint = JSON.parse(docker('docker-endpoint', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}', dockerContext], 20000));
      assert.ok(endpoint.startsWith('npipe://') || endpoint.startsWith('unix://'), 'LOCAL_DOCKER_ENGINE_REQUIRED');
      docker('compose-plugin-version', ['compose', 'version'], 20000);
      command('source-archive', 'git', ['archive', '--format=tar', '--output', join(directory, 'source.tar'), sha], 30000, process.cwd());
      command('source-extract', 'tar', ['-xf', join(directory, 'source.tar'), '-C', clean], 30000);
      const envFile = join(directory, 'fixture.env'), imageTag = `workload-${sha.slice(0, 12)}-${run}`;
      const fixture = { IMAGE_TAG: imageTag, STAGING_DB_PASSWORD: randomBytes(24).toString('hex'), STAGING_AUTH_SECRET: randomBytes(32).toString('hex'), WORKLOAD_VAULT_KEY: randomBytes(32).toString('hex'), WORKLOAD_STAFF_PASSWORD: randomBytes(20).toString('hex'), WORKLOAD_SOURCE_SHA: sha, WORKLOAD_PROJECT: project };
      writeFileSync(envFile, Object.entries(fixture).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
      manifest.imageTag = imageTag; saveManifest();
      compose = ['compose', '--project-name', project, '--env-file', envFile, '-f', 'compose.staging.yml', '-f', 'compose.workload.yml'];
      const config = JSON.parse(dc('resolved-compose', ['config', '--format', 'json']));
      writeFileSync(join(directory, 'resolved-compose.log'), 'PRIVATE_FIXTURE_CONFIGURATION_DISCARDED\n');
      assert.equal(config.name, project); assert.equal(config.networks.isolated.internal, true);
      assert.deepEqual(Object.keys(config.networks), ['isolated']);
      for (const service of Object.values(config.services)) assert.ok(!service.ports?.length && !service.network_mode);
      assert.equal(dc('refuse-existing-project', ['ps', '-aq']).trim(), '', 'EXISTING_PROJECT_REFUSED');
      assert.equal(docker('refuse-existing-volumes', ['volume', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Name}}']).trim(), '', 'EXISTING_VOLUMES_REFUSED');
      const buildDeadline = Date.now() + 8 * 60 * 1000;
      for (const target of ['builder', 'migrator', 'runner']) {
        const remaining = buildDeadline - Date.now(); assert.ok(remaining > 0, 'BOUNDED_BUILD_WINDOW');
        docker(`build-${target}`, ['build', '--target', target, '--label', `org.opencontainers.image.revision=${sha}`, '-t', `${target === 'builder' ? 'stor24-workload-builder' : target === 'migrator' ? 'stor24-crm-migrate' : 'stor24-crm'}:${imageTag}`, '.'], remaining);
      }
      const networkName = `${project}_isolated`;
      servicesStarted = true;
      manifest.resourcesMayExist = true; saveManifest();
      dc('postgres-start', ['up', '-d', 'postgres']); await waitHealthy('postgres');
      const network = JSON.parse(docker('network-inspect', ['network', 'inspect', networkName]))[0];
      assert.equal(network.Internal, true); assert.equal(network.Labels['com.docker.compose.project'], project);
      dc('bootstrap', ['run', '--rm', '--no-deps', 'bootstrap'], 120000);
      dc('seed', ['run', '--rm', '--no-deps', 'workload-seed'], 120000);
      dc('app-start', ['up', '-d', '--no-deps', 'app']); await waitHealthy('app');
      dc('http-workload', ['exec', '-T', 'app', 'node', '/workload/test-next-representative-workload.mjs', '--client'], 180000);
      dc('database-verify', ['run', '--rm', '--no-deps', 'workload-seed', 'node', '--import', 'tsx', 'scripts/seed-next-workload.ts', '--verify'], 30000);
      inspectContainers();
      manifest.result = 'PASS';
    } catch (error) {
      manifest.result = 'FAIL'; manifest.errorCode = /^ISOLATED_PHASE_FAILED_[a-z-]+$/.test(error.message) ? error.message : 'ISOLATED_WORKLOAD_GUARD_OR_ASSERTION_FAILED';
      process.exitCode = 1;
    } finally {
      if (servicesStarted) {
        // Preserve safe measurement/count evidence even when HTTP or database assertions fail.
        // Collection must not replace the original failure or prevent owned-container stop.
        manifest.evidenceCollection = {};
        for (const name of ['http-result', 'database-result']) {
          try {
            const raw = dc(`read-${name}`, ['exec', '-T', 'app', 'node', '-e', `process.stdout.write(require('node:fs').readFileSync('/workload-evidence/${name}.json','utf8'))`], 10000);
            const data = JSON.parse(raw); assert.equal(data.sourceSha, sha);
            assert.ok(Buffer.byteLength(raw) < 65536, 'BOUNDED_SAFE_EVIDENCE');
            writeFileSync(join(directory, `${name}.json`), JSON.stringify(data, null, 2));
            manifest.evidenceCollection[name] = 'RETAINED';
          } catch { manifest.evidenceCollection[name] = 'UNAVAILABLE'; }
        }
        if (manifest.result === 'PASS' && Object.values(manifest.evidenceCollection).some(value => value !== 'RETAINED')) {
          manifest.result = 'INCOMPLETE'; process.exitCode = 1;
        }
        try {
          const owned = inspectContainers(false).filter(item => item.State.Running);
          if (owned.length) docker('stop-owned-services', ['stop', ...owned.map(item => item.Id)]);
          manifest.cleanup = 'Owned containers stopped; volumes/logs retained. No destructive cleanup.';
        }
        catch { if (manifest.result === 'PASS') manifest.result = 'INCOMPLETE'; manifest.cleanup = 'Owned resources retained; normal stop did not complete. Inspect recorded project before cleanup.'; process.exitCode = 1; }
      }
      else manifest.cleanup = 'No Compose service startup attempted. Images/build activity, if any, retained for inspection.';
      manifest.finishedAt = new Date().toISOString();
      saveManifest();
      console.log(JSON.stringify({ result: manifest.result, sourceSha: sha, project, artifactDirectory: directory, cleanup: manifest.cleanup }));
    }
  })();
}

if (process.argv.includes('--client')) await client();
else if (process.argv.includes('--run')) await host();
else throw new Error('EXPLICIT_ISOLATED_WORKLOAD_MODE_REQUIRED');
