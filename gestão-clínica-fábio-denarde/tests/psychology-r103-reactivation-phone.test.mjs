import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import React from 'react';

import {
  formatPsychologyPhoneDisplay,
  formatPsychologyPhoneInput,
  normalizePsychologyPhoneForComparison,
  normalizePsychologyPhoneForWrite,
} from '../src/features/psychology-pilot/psychologyPhone.ts';
import {
  formatPhoneDisplay,
  normalizeMetaPhoneRecipient,
  normalizePhoneForIntegration,
} from '../shared/phoneNormalization.js';
import { createPsychologyApiHandler } from '../api/psychology.js';
import { createPsychologyRemotePatientClient } from '../src/features/psychology-persistence/remotePatientClient.ts';
import { createPsychologyPersistenceScope } from '../src/features/psychology-persistence/scope.ts';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 900,
  atob: globalThis.atob,
  btoa: globalThis.btoa,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = {
  addEventListener() {},
  removeEventListener() {},
};

const { PatientDialogR2F3E } = await import('../src/features/psychology-pilot/PsychologyPilot.tsx');
let TestRenderer;
let act;
try {
  ({ default: TestRenderer, act } = await import('react-test-renderer'));
} catch {
  // The declared test dependency is optional in this checkout; static/source
  // and API tests below still run without changing the product tree.
}

function textContent(node) {
  return node.children?.map(child => typeof child === 'string' ? child : textContent(child)).join('') || '';
}

function findButton(renderer, label) {
  return renderer.root.findAllByType('button').find(button => textContent(button).includes(label));
}

function deferred() {
  let resolve;
  const promise = new Promise(result => { resolve = result; });
  return { promise, resolve };
}

const inactivePatient = {
  id: 'r103-inactive-patient',
  professionalId: 'r103-professional',
  context: 'PSICOLOGIA',
  name: 'Paciente Sintético R103',
  dateOfBirth: '1990-01-01',
  birthDate: '1990-01-01',
  phone: "'+55 (27) 99510-3401",
  email: 'r103@example.test',
  preferredModality: 'presencial',
  active: false,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
};

test('R103 telefone administrativo remove artefatos na edição e preserva a chave de integração', () => {
  const importedValues = [
    "'+55 (27) 99510-3401",
    '+5527995103401',
    '5527995103401',
    '(27) 99510-3401',
  ];
  importedValues.forEach(value => {
    assert.equal(formatPsychologyPhoneDisplay(value), '(27) 99510-3401');
    assert.equal(formatPsychologyPhoneInput(value).includes('+55'), false);
    assert.equal(normalizePsychologyPhoneForComparison(value), '5527995103401');
    assert.equal(normalizePsychologyPhoneForWrite(value), '5527995103401');
  });
  assert.equal(formatPhoneDisplay('+447731970794', { includeCountryCode: true }), '+44 7731970794');
  assert.equal(formatPsychologyPhoneDisplay('+447731970794'), '+44 7731970794');
  assert.equal(normalizePhoneForIntegration('(27) 99510-3401', { defaultCountryCode: '55' }).canonicalPhone, '5527995103401');
  assert.equal(normalizeMetaPhoneRecipient("'+55 (27) 99510-3401").canonicalPhone, '5527995103401');
  const source = fs.readFileSync(new URL('../src/features/psychology-pilot/PsychologyPilot.tsx', import.meta.url), 'utf8');
  const dialog = source.slice(source.indexOf('function PatientDialogR2F3E'), source.indexOf('function PatientDialog('));
  assert.match(dialog, /phone: formatPsychologyPhoneInput\(value\?\.phone/);
  assert.match(dialog, /administrativeResponsible\.phone/);
  assert.doesNotMatch(dialog, /Inativar paciente/);
});

test('R103 cliente remoto envia uma única reativação como PATCH sem criar paciente', async () => {
  const requests = [];
  const scope = createPsychologyPersistenceScope('r103-professional', 'r103-workspace');
  const client = createPsychologyRemotePatientClient({
    scope,
    now: () => NOW,
    api: {
      getToken: async () => 'synthetic-token',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), method: init?.method, body: init?.body });
        return new Response(JSON.stringify({
          scope: { workspaceId: scope.workspaceId, professionalId: scope.professionalId, context: 'PSICOLOGIA' },
          patient: { ...inactivePatient, active: true, updatedAt: NOW },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  const saved = await client.reactivatePatient(inactivePatient.id);
  assert.equal(saved.active, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'PATCH');
  assert.match(requests[0].url, /\/patients\/r103-inactive-patient$/);
  assert.deepEqual(JSON.parse(requests[0].body), { active: true });
});

test('R103 diálogo oferece reativação somente para inativo e bloqueia duplo clique', { skip: !TestRenderer }, async () => {
  const pending = deferred();
  let calls = 0;
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(PatientDialogR2F3E, {
      value: inactivePatient,
      onClose() {},
      onSave() { return true; },
      onReactivate() { calls += 1; return pending.promise; },
    }));
  });
  const phoneInput = renderer.root.findAllByType('input').find(input => input.props.value === '(27) 99510-3401');
  assert.ok(phoneInput, 'legacy +55 value must be displayed in local Brazilian format');
  assert.ok(findButton(renderer, 'Reativar paciente'));
  act(() => { findButton(renderer, 'Reativar paciente').props.onClick(); });
  const confirm = findButton(renderer, 'Confirmar reativação');
  assert.ok(confirm, 'inactive patient must require explicit confirmation');
  await act(async () => {
    confirm.props.onClick();
    confirm.props.onClick();
    await Promise.resolve();
  });
  assert.equal(calls, 1, 'same-tick confirmation clicks must invoke one mutation');
  assert.ok(findButton(renderer, 'Reativando...'));
  await act(async () => {
    pending.resolve(true);
    await pending.promise;
  });
  assert.equal(calls, 1);
  act(() => renderer.unmount());

  let activeRenderer;
  act(() => {
    activeRenderer = TestRenderer.create(React.createElement(PatientDialogR2F3E, {
      value: { ...inactivePatient, active: true },
      onClose() {},
      onSave() { return true; },
      onReactivate() { throw new Error('active patient must not expose reactivation'); },
    }));
  });
  assert.equal(Boolean(findButton(activeRenderer, 'Reativar paciente')), false);
  assert.equal(Boolean(findButton(activeRenderer, 'Inativar paciente')), false);
  act(() => activeRenderer.unmount());
});

test('R103 reativação permite nova tentativa somente após falha', { skip: !TestRenderer }, async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(PatientDialogR2F3E, {
      value: inactivePatient,
      onClose() {},
      onSave() { return true; },
      onReactivate() { calls += 1; return calls === 1 ? first.promise : second.promise; },
    }));
  });
  act(() => { findButton(renderer, 'Reativar paciente').props.onClick(); });
  act(() => { findButton(renderer, 'Confirmar reativação').props.onClick(); });
  await act(async () => { first.resolve(false); await first.promise; });
  assert.ok(renderer.root.findAll(node => node.props?.['data-testid'] === 'psychology-patient-reactivation-error').length);
  act(() => { findButton(renderer, 'Reativar paciente').props.onClick(); });
  act(() => { findButton(renderer, 'Confirmar reativação').props.onClick(); });
  assert.equal(calls, 2);
  await act(async () => { second.resolve(true); await second.promise; });
  act(() => renderer.unmount());
});

class FakeDocument {
  constructor(store, path, id) { this.store = store; this.path = path; this.id = id; }
  async get() {
    const value = this.store.get(`${this.path}/${this.id}`);
    return { exists: Boolean(value), id: this.id, data: () => value ? structuredClone(value) : undefined };
  }
  async set(value) { this.store.set(`${this.path}/${this.id}`, structuredClone(value)); }
  async delete() { this.store.delete(`${this.path}/${this.id}`); }
}

class FakeQuery {
  constructor(store, path, field, value) { this.store = store; this.path = path; this.field = field; this.value = value; }
  limit() { return this; }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) }))
      .filter(snapshot => snapshot.data()?.[this.field] === this.value);
    return { docs };
  }
}

class FakeCollection {
  constructor(store, path) { this.store = store; this.path = path; }
  doc(id) { return new FakeDocument(this.store, this.path, id); }
  where(field, _operator, value) { return new FakeQuery(this.store, this.path, field, value); }
  async get() {
    const prefix = `${this.path}/`;
    return { docs: [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix) && key.slice(prefix.length).indexOf('/') < 0)
      .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => structuredClone(value) })) };
  }
}

class FakeDb {
  constructor() { this.store = new Map(); }
  collection(path) { return new FakeCollection(this.store, path); }
}

const NOW = '2026-08-29T00:00:00.000Z';
const WORKSPACE = 'workspace-r103-synthetic';
const scopes = {
  editOnly: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r103-a', context: 'PSICOLOGIA', role: 'professional', permissions: ['patients.list', 'patients.create', 'patients.edit'] },
  noEdit: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r103-a', context: 'PSICOLOGIA', role: 'professional', permissions: ['patients.list', 'patients.create'] },
  otherProfessional: { workspaceId: WORKSPACE, tenantId: WORKSPACE, professionalId: 'professional-r103-b', context: 'PSICOLOGIA', role: 'professional', permissions: ['patients.list', 'patients.create', 'patients.edit'] },
};

function scopeForToken(token) {
  if (token === 'edit-only') return scopes.editOnly;
  if (token === 'no-edit') return scopes.noEdit;
  if (token === 'other-professional') return scopes.otherProfessional;
  throw Object.assign(new Error('Sessão sintética não identificada.'), { code: 'access/missing-auth-token', statusCode: 401 });
}

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
      const scope = scopeForToken(token);
      for (const permission of options.requiredPermissions || []) {
        if (!scope.permissions.includes(permission)) throw Object.assign(new Error('Permissão sintética negada.'), { code: 'access/permission-denied', statusCode: 403 });
      }
      return Object.freeze(scope);
    },
    auditLogger: () => {},
  });
}

async function call(handler, method, path, token, body) {
  const req = {
    method,
    url: `/api/psychology?path=${encodeURIComponent(path)}`,
    query: { path },
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body }),
  };
  const res = capture();
  await handler(req, res);
  return res;
}

function patient(id) {
  return { id, name: `Paciente ${id}`, birthDate: '1990-01-01', phone: '27999900103', preferredModality: 'online', active: false };
}

test('R103 PATCH de reativação preserva ID, escopo Psicologia e exige patients.edit', async () => {
  const source = fs.readFileSync(new URL('../api/psychology.js', import.meta.url), 'utf8');
  assert.match(source, /resource === 'patients' && req\.method === 'PATCH' && id[\s\S]*requiredPermissions: \['patients\.edit'\]/);
  const db = new FakeDb();
  const handler = createSyntheticHandler(db);
  const patientId = 'r103-reactivation-patient';
  const created = await call(handler, 'POST', 'patients', 'edit-only', patient(patientId));
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.patient.active, false);
  const reactivated = await call(handler, 'PATCH', `patients/${patientId}`, 'edit-only', { active: true });
  assert.equal(reactivated.statusCode, 200);
  assert.equal(reactivated.body.patient.id, patientId);
  assert.equal(reactivated.body.patient.active, true);
  const denied = await call(handler, 'PATCH', `patients/${patientId}`, 'no-edit', { active: true });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error.code, 'access/permission-denied');
  const crossScope = await call(handler, 'PATCH', `patients/${patientId}`, 'other-professional', { active: true });
  assert.equal(crossScope.statusCode, 404);
  assert.equal(crossScope.body.error.code, 'psychology/patient-not-found');
});
