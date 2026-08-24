import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkFirebaseFirestoreEmulator, createFirebaseFirestoreEmulatorClient } from '../src/features/psychology-persistence';

const RULES_PATH = 'docs/PSICOLOGIA_R2D2E_RULES_COMPOSTAS.rules';
const PROJECT_ID = 'psychology-r2d2e-local';
const HOST = '127.0.0.1';
const PORT = 8082;

test('R2D2E Rules — composição preserva matches legados e deny canônico', () => {
  const rules = readFileSync(RULES_PATH, 'utf8');
  for (const fragment of [
    'match /users/{userId}',
    'match /externalRegistrationForms/{formId}',
    'match /whatsappOperationalReports/{reportDate}',
    'match /patients/{patientId}',
    'match /workspaces/{workspaceId}/professionals/{professionalId}/contexts/PSICOLOGIA/{document=**}',
    'match /accessProfiles/{uid}',
    'allow read, write: if false',
  ]) assert.ok(rules.includes(fragment), `Rules sem fragmento: ${fragment}`);
});

test('R2D2E Rules Emulator — client não lê namespace Psicologia nem identidade', async () => {
  await checkFirebaseFirestoreEmulator({ projectId: PROJECT_ID, host: HOST, port: PORT });
  const client = createFirebaseFirestoreEmulatorClient({ projectId: PROJECT_ID, host: HOST, port: PORT });
  await assert.rejects(() => client.get('workspaces/workspace-synthetic/professionals/professional-synthetic/contexts/PSICOLOGIA/patients/patient-synthetic'), /Firestore emulator 403/);
  await assert.rejects(() => client.get('accessProfiles/auth-synthetic'), /Firestore emulator 403/);
});
