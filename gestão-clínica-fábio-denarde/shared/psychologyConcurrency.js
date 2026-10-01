// Transport metadata only. Symbols survive object spreads but never JSON/Firestore.
const SNAPSHOT = Symbol('psychology-edit-baseline');
const managed = new Set(['id', 'workspaceId', 'professionalId', 'tenantId', 'context', 'bindingMode',
  'audit', 'createdAt', 'updatedAt', '__psychologyVersion', 'permissions', 'effectivePermissions', 'role']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const json = value => value == null ? value : JSON.parse(JSON.stringify(value));
export const PSYCHOLOGY_CONFLICT_MESSAGE = 'Este registro foi alterado em outra sessão. Atualize os dados antes de tentar salvar novamente.';
export function psychologyPersistenceError(code, statusCode = 422) {
  return Object.assign(new Error(code === 'psychology/concurrent-change' ? PSYCHOLOGY_CONFLICT_MESSAGE
    : 'Não foi possível validar a alteração. Atualize os dados antes de salvar.'), {
    code, statusCode, persistenceStatus: statusCode === 409 ? 'CONFLICT' : 'VALIDATION_FAILED',
  });
}

export function psychologyStableJson(value) {
  const sorted = item => Array.isArray(item) ? item.map(sorted) : plain(item)
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined && key !== '__psychologyVersion').map(key => [key, sorted(item[key])])) : item;
  return JSON.stringify(sorted(json(value)));
}
const equal = (left, right) => psychologyStableJson(left) === psychologyStableJson(right);

export function capturePsychologyBaseline(record, wire, ui = record) {
  const previous = wire?.[SNAPSHOT];
  record[SNAPSHOT] = {
    wire: json(previous?.wire || wire), ui: json(ui),
    fingerprint: previous?.fingerprint || wire?.__psychologyVersion,
  };
  return record;
}
export function copyPsychologyBaseline(record, source) {
  if (source?.[SNAPSHOT]) record[SNAPSHOT] = source[SNAPSHOT];
  return record;
}
export function pinPsychologyEdit(input, source, extraFields = []) {
  if (source?.[SNAPSHOT]) input[SNAPSHOT] = { ...source[SNAPSHOT],
    fields: [...Object.keys(input).map(key => key === 'dateOfBirth' ? 'birthDate' : key), ...extraFields] };
  return input;
}
export function psychologyBaseline(record) { return record?.[SNAPSHOT]; }

function editable(value, aggregate, depth = 0, parent = '') {
  if (Array.isArray(value)) return value.map(item => editable(item, aggregate, depth + 1));
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => item !== undefined
    && key !== 'updatedAt' && key !== 'createdAt'
    && !(aggregate === 'settings' && parent === 'professionalProfile' && ['name', 'specialty', 'crp'].includes(key))
    && (depth !== 0 || (!managed.has(key) && !(aggregate === 'patients' && ['dateOfBirth', 'administrativeNotes'].includes(key)))))
    .map(([key, item]) => [key, editable(item, aggregate, depth + 1, key)]));
}
export function psychologyField(value, path) {
  let current = value;
  for (const key of path) {
    if (!plain(current) || !own(current, key) || current[key] === undefined) return { present: false };
    current = current[key];
  }
  return { present: true, value: json(current) };
}
const equalField = (a, b) => a.present === b.present && (!a.present || equal(a.value, b.value));

function delta(before, after, wire, prefix = []) {
  const result = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const path = [...prefix, key];
    const a = psychologyField(before, [key]), b = psychologyField(after, [key]);
    if (equalField(a, b)) continue;
    if (b.present && plain(b.value) && (!a.present || plain(a.value)) && Object.keys(b.value).length) {
      result.push(...delta(a.present ? a.value : {}, b.value, wire, path));
    } else result.push({ path, before: psychologyField(wire, path), after: b,
      parents: path.slice(0, -1).map((_, index) => {
        const parent = psychologyField(wire, path.slice(0, index + 1));
        return { present: parent.present, map: parent.present && plain(parent.value) };
      }),
    });
  }
  return result;
}
function overlay(before, patch) {
  const next = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = plain(value) && plain(before[key]) ? overlay(before[key], value) : value;
  }
  return next;
}

export function buildPsychologyChange(aggregate, id, intended, baseline, partial = false) {
  const saved = psychologyBaseline(intended) || psychologyBaseline(baseline);
  if (!saved) {
    if (partial) throw psychologyPersistenceError('psychology/baseline-required');
    return { version: 1, operation: 'create', id, data: { ...editable(intended, aggregate), id } };
  }
  const before = editable(saved.ui, aggregate);
  const wanted = partial ? overlay(before, intended) : editable(intended, aggregate);
  if (aggregate === 'settings' && !saved.fingerprint) {
    return { version: 1, operation: 'create', id, data: { ...editable(wanted, aggregate), id } };
  }
  const changes = delta(before, editable(wanted, aggregate), saved.wire)
    .filter(change => !saved.fields || saved.fields.includes(aggregate === 'settings' ? change.path[1] : change.path[0]));
  return { version: 1, operation: 'update', id, changes };
}

export function buildPsychologyDelete(id, baseline) {
  const fingerprint = psychologyBaseline(baseline)?.fingerprint;
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw psychologyPersistenceError('psychology/baseline-required');
  }
  return { version: 1, operation: 'delete', id, fingerprint };
}

export function validatePsychologyChange(change) {
  const invalid = () => { throw psychologyPersistenceError('psychology/invalid-change'); };
  if (!plain(change) || change.version !== 1 || typeof change.id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(change.id)) invalid();
  if (change.operation === 'delete') {
    if (typeof change.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(change.fingerprint)) invalid();
    return change;
  }
  const validateValue = (value, depth = 0) => {
    if (depth > 24) invalid();
    if (Array.isArray(value)) value.forEach(item => validateValue(item, depth + 1));
    else if (plain(value)) Object.entries(value).forEach(([key, item]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || /^__.*__$/.test(key)) invalid();
      validateValue(item, depth + 1);
    });
    else if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))
      || !['string', 'number', 'boolean', 'object'].includes(typeof value)) invalid();
  };
  if (change.operation === 'create') {
    if (!plain(change.data) || change.data.id !== change.id) invalid();
    validateValue(change.data);
    if (new TextEncoder().encode(JSON.stringify(change)).length > 900 * 1024) invalid();
    return change;
  }
  if (change.operation !== 'update' || !Array.isArray(change.changes) || change.changes.length > 1000) invalid();
  const paths = [];
  for (const item of change.changes) {
    if (!plain(item) || !Array.isArray(item.path) || !item.path.length || item.path.length > 20
      || item.path.some(part => typeof part !== 'string' || !part || ['__proto__', 'constructor', 'prototype'].includes(part) || /^__.*__$/.test(part))
      || managed.has(item.path[0]) || ['createdAt', 'updatedAt'].includes(item.path.at(-1))) invalid();
    for (const value of [item.before, item.after]) {
      if (!plain(value) || typeof value.present !== 'boolean' || (value.present && !own(value, 'value'))) invalid();
    }
    if (!Array.isArray(item.parents) || item.parents.length !== item.path.length - 1
      || item.parents.some(p => !plain(p) || typeof p.present !== 'boolean' || typeof p.map !== 'boolean')) invalid();
    if (item.before.present) validateValue(item.before.value);
    if (item.after.present) validateValue(item.after.value);
    const encoded = JSON.stringify(item.path);
    if (paths.some(path => path.every((part, i) => part === item.path[i])
      || item.path.every((part, i) => part === path[i]))) invalid();
    paths.push(item.path);
    if (encoded.length > 6000) invalid();
  }
  if (new TextEncoder().encode(JSON.stringify(change)).length > 900 * 1024) invalid();
  return change;
}

export function assertPsychologyBaseline(current, changes) {
  for (const item of changes) {
    if (!equalField(psychologyField(current, item.path), item.before)) throw psychologyPersistenceError('psychology/concurrent-change', 409);
    for (let index = 0; index < item.parents.length; index++) {
      const now = psychologyField(current, item.path.slice(0, index + 1));
      const old = item.parents[index];
      if ((old.present && (!now.present || !plain(now.value)))
        || (!old.present && now.present && !plain(now.value))) throw psychologyPersistenceError('psychology/concurrent-change', 409);
    }
  }
}

export function applyPsychologyChanges(record, changes) {
  const next = json(record || {});
  for (const item of changes) {
    let parent = next;
    for (const key of item.path.slice(0, -1)) {
      if (!plain(parent[key])) parent[key] = {};
      parent = parent[key];
    }
    if (item.after.present) parent[item.path.at(-1)] = json(item.after.value);
    else delete parent[item.path.at(-1)];
  }
  return next;
}
