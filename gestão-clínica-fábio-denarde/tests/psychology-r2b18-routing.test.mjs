import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createPsychologyApiHandler } from '../api/psychology.js';

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const { default: psychologyHandler } = await import('../api/psychology.js');

class FakeDocument {
  constructor(store, path, id) { this.store = store; this.path = path; this.id = id; }
  async get() {
    const value = this.store.get(`${this.path}/${this.id}`);
    return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined };
  }
  async set(value) { this.store.set(`${this.path}/${this.id}`, structuredClone(value)); }
  async delete() { this.store.delete(`${this.path}/${this.id}`); }
}

class FakeCollection {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new FakeDocument(this.store, this.path, id); }
  async get() {
    const prefix = `${this.path}/`;
    return {
      docs: [...this.store.entries()]
        .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
        .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })),
    };
  }
}

class FakeDb {
  constructor() { this.store = new Map(); }
  collection(path) { return new FakeCollection(this.store, path); }
}

const NOW = '2026-08-23T00:00:00.000Z';
const SCOPE = {
  workspaceId: 'workspace-r2b18-synthetic',
  tenantId: 'workspace-r2b18-synthetic',
  professionalId: 'professional-r2b18-synthetic',
  context: 'PSICOLOGIA',
  role: 'professional',
  authUid: 'auth-r2b18-synthetic',
  permissions: [
    'patients.list',
    'patients.create',
    'patients.edit',
    'patients.delete',
    'agenda.own.view',
    'agenda.edit',
    'settings.clinic.manage',
  ],
};

function capture() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

function createSyntheticHandler(db) {
  return createPsychologyApiHandler({
    getDb: () => db,
    now: () => NOW,
    resolveAccess: async (req, options = {}) => {
      const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      if (token !== 'synthetic') throw Object.assign(new Error('Sessão sintética não identificada.'), { code: 'access/missing-auth-token', statusCode: 401 });
      for (const permission of options.requiredPermissions || []) {
        if (!SCOPE.permissions.includes(permission)) throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
      }
      return Object.freeze(SCOPE);
    },
    auditLogger: () => {},
  });
}

async function callRewritten(handler, method, path, body) {
  const req = {
    method,
    url: `/api/psychology?path=${encodeURIComponent(path)}`,
    query: { path },
    headers: { authorization: 'Bearer synthetic' },
    ...(body === undefined ? {} : { body }),
  };
  const res = capture();
  await handler(req, res);
  return res;
}

function applyConfiguredRewrite(url, method, headers, body) {
  const incoming = new URL(url, 'http://localhost');
  const match = incoming.pathname.match(/^\/api\/psychology\/([^/]+)\/([^/]+)$/);
  assert.ok(match, 'synthetic URL must match the configured nested route');
  const query = new URLSearchParams({ path: `${match[1]}/${match[2]}` });
  for (const [key, value] of incoming.searchParams) query.append(key, value);
  return { method, headers, body, path: `/api/psychology?${query.toString()}` };
}

test('R2B18 Vercel rewrite preserves path, method, Authorization, query and body', () => {
  const rewrite = vercel.rewrites.find(entry => entry.source === '/api/psychology/:resource/:id');
  assert.deepEqual(rewrite, {
    source: '/api/psychology/:resource/:id',
    destination: '/api/psychology?path=:resource/:id',
  });
  const headers = { Authorization: 'Bearer synthetic' };
  const body = JSON.stringify({ name: 'ROUTE PROBE SYNTHETIC' });
  for (const method of ['GET', 'PATCH', 'DELETE', 'PUT']) {
    const rewritten = applyConfiguredRewrite('/api/psychology/patients/test-id?view=summary', method, headers, body);
    assert.equal(rewritten.path, '/api/psychology?path=patients%2Ftest-id&view=summary');
    assert.equal(rewritten.method, method);
    assert.equal(rewritten.headers, headers);
    assert.equal(rewritten.body, body);
  }
});

test('R2B18 nested route reaches the real Psychology handler before Firebase resolution', async () => {
  const originalInfo = console.info;
  console.info = () => {};
  const res = capture();
  try {
    await psychologyHandler({ method: 'GET', url: '/api/psychology?path=patients/route-probe', query: { path: 'patients/route-probe' }, headers: {} }, res);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error?.code, 'psychology/missing-auth-token');
});

test('R2B18 representative ID operations reach patients, sessions, services and locations', async () => {
  const handler = createSyntheticHandler(new FakeDb());
  const patientId = 'r2b18-patient';
  const sessionPatientId = 'r2b18-session-patient';
  const sessionId = 'r2b18-session';
  const serviceId = 'r2b18-service';
  const locationId = 'r2b18-location';

  assert.equal((await callRewritten(handler, 'POST', 'patients', { id: patientId, name: 'ROUTE PROBE PATIENT', birthDate: '1990-01-01', phone: '27999990018', preferredModality: 'online' })).statusCode, 201);
  assert.equal((await callRewritten(handler, 'GET', `patients/${patientId}`)).body.items[0].id, patientId);
  assert.equal((await callRewritten(handler, 'PATCH', `patients/${patientId}`, { name: 'ROUTE PROBE PATIENT EDITED' })).body.patient.name, 'ROUTE PROBE PATIENT EDITED');
  assert.equal((await callRewritten(handler, 'DELETE', `patients/${patientId}`)).body.deleted, true);

  assert.equal((await callRewritten(handler, 'POST', 'patients', { id: sessionPatientId, name: 'ROUTE PROBE SESSION PATIENT', birthDate: '1990-01-01', phone: '27999990019', preferredModality: 'online' })).statusCode, 201);
  assert.equal((await callRewritten(handler, 'POST', 'sessions', { id: sessionId, patientId: sessionPatientId, date: '2026-08-24', time: '09:00', durationMinutes: 50, modality: 'online', status: 'agendada' })).statusCode, 201);
  assert.equal((await callRewritten(handler, 'PATCH', `sessions/${sessionId}`, { time: '10:00' })).body.session.time, '10:00');
  assert.equal((await callRewritten(handler, 'DELETE', `sessions/${sessionId}`)).body.deleted, true);

  assert.equal((await callRewritten(handler, 'POST', 'services', { id: serviceId, name: 'ROUTE PROBE SERVICE', defaultDurationMinutes: 50, defaultPrice: 0, modality: 'BOTH', active: true })).statusCode, 201);
  assert.equal((await callRewritten(handler, 'PATCH', `services/${serviceId}`, { name: 'ROUTE PROBE SERVICE EDITED' })).body.service.name, 'ROUTE PROBE SERVICE EDITED');
  assert.equal((await callRewritten(handler, 'DELETE', `services/${serviceId}`)).body.deleted, true);

  assert.equal((await callRewritten(handler, 'POST', 'locations', { id: locationId, type: 'OTHER', displayName: 'ROUTE PROBE LOCATION', active: true, isPrimary: false, color: '#7C3AED' })).statusCode, 201);
  assert.equal((await callRewritten(handler, 'PATCH', `locations/${locationId}`, { displayName: 'ROUTE PROBE LOCATION EDITED' })).body.location.displayName, 'ROUTE PROBE LOCATION EDITED');
  assert.equal((await callRewritten(handler, 'DELETE', `locations/${locationId}`)).body.deleted, true);
});
