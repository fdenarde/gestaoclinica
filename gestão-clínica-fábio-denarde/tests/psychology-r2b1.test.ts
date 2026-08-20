import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { csvHasPatientShape, getCsvValue, isValidIsoDate, normalizeCsvHeader, normalizeTimeValue, parseCsvText, parseDateValue, parseNumberValue } from '../src/features/psychology-import-export/csv';
import { CsvImportAdapter, DoctoraliaImportAdapter, GestaoClinicaBackupAdapter } from '../src/features/psychology-import-export/adapters';
import { buildPsychologyBackupFiles, createPsychologyBackupZip, createSyntheticPsychologyStore, verifyPsychologyBackupFiles, verifyPsychologyBackupZip } from '../src/features/psychology-import-export/backup';
import { createEmptyImportBundle, normalizeCsvRows, previewImport } from '../src/features/psychology-import-export/normalize';
import { runPsychologyDryRun } from '../src/features/psychology-import-export/pipeline';
import { deduplicatePsychologyBundle } from '../src/features/psychology-import-export/deduplication';
import { DOCTORALIA_UNRECOGNIZED_MESSAGE, REAL_IMPORT_DISABLED_MESSAGE, type ImportFileInput } from '../src/features/psychology-import-export/types';

const csv = 'entity,id,nome,data_nascimento,telefone,data,hora,paciente_id\npatient,p-001,Paciente Sintético,10/05/1990,(27) 99999-1111,,,\nappointment,a-001,,,,2026-01-16,09:00,p-001';
const csvInput: ImportFileInput = { source: 'csv', fileName: 'sintetico.csv', mimeType: 'text/csv', text: csv, bytes: new TextEncoder().encode(csv) };

function freshStore() { return createSyntheticPsychologyStore(); }

// Parser and CSV adapter: 1–10
test('R2B1 parser 01 — lê cabeçalho CSV', () => assert.deepEqual(parseCsvText(csv).fields.slice(0, 3), ['entity', 'id', 'nome']));
test('R2B1 parser 02 — lê duas linhas CSV', () => assert.equal(parseCsvText(csv).rows.length, 2));
test('R2B1 parser 03 — normaliza acentos do cabeçalho', () => assert.equal(normalizeCsvHeader('Data de Nascimento'), 'datadenascimento'));
test('R2B1 parser 04 — converte data brasileira', () => assert.equal(parseDateValue('10/05/1990'), '1990-05-10'));
test('R2B1 parser 05 — mantém data ISO', () => assert.equal(parseDateValue('2026-01-16'), '2026-01-16'));
test('R2B1 parser 06 — valida data ISO', () => assert.equal(isValidIsoDate('2026-01-16'), true));
test('R2B1 parser 07 — rejeita horário inválido', () => assert.equal(normalizeTimeValue('25:90'), undefined));
test('R2B1 parser 08 — normaliza horário', () => assert.equal(normalizeTimeValue('9:05'), '09:05'));
test('R2B1 parser 09 — converte valor brasileiro', () => assert.equal(parseNumberValue('R$ 1.234,50'), 1234.5));
test('R2B1 parser 10 — adapta paciente e consulta', () => { const bundle = normalizeCsvRows(parseCsvText(csv).rows, csvInput); assert.equal(bundle.patients.length, 1); assert.equal(bundle.appointments[0]?.patientExternalId, 'p-001'); });

// Backup and integrity: 11–20
test('R2B1 backup 11 — reconhece adaptador CSV', () => assert.equal(new CsvImportAdapter().recognize(csvInput).recognized, true));
test('R2B1 backup 12 — cria arquivos versionados', async () => assert.equal((await buildPsychologyBackupFiles(freshStore())).some(file => file.path === 'manifest.json'), true));
test('R2B1 backup 13 — manifesto informa contexto Psicologia', async () => { const files = await buildPsychologyBackupFiles(freshStore()); const manifest = JSON.parse(new TextDecoder().decode(files[0].bytes)); assert.equal(manifest.context, 'PSICOLOGIA'); });
test('R2B1 backup 14 — manifesto usa SHA-256', async () => { const files = await buildPsychologyBackupFiles(freshStore()); const manifest = JSON.parse(new TextDecoder().decode(files[0].bytes)); assert.equal(manifest.checksumAlgorithm, 'SHA-256'); });
test('R2B1 backup 15 — manifesto lista seções obrigatórias', async () => { const files = await buildPsychologyBackupFiles(freshStore()); const manifest = JSON.parse(new TextDecoder().decode(files[0].bytes)); assert.ok(manifest.sections.some((section: { path: string }) => section.path === 'appointments.json')); });
test('R2B1 backup 16 — verifica backup íntegro', async () => assert.equal((await verifyPsychologyBackupFiles(await buildPsychologyBackupFiles(freshStore()))).status, 'intact'));
test('R2B1 backup 17 — cria ZIP local armazenado', async () => { const zip = await createPsychologyBackupZip(freshStore()); assert.equal(zip[0], 0x50); assert.equal(zip[1], 0x4b); });
test('R2B1 backup 18 — verifica ZIP criado', async () => assert.equal((await verifyPsychologyBackupZip(await createPsychologyBackupZip(freshStore()))).intact, true));
test('R2B1 backup 19 — acusa checksum alterado', async () => { const files = await buildPsychologyBackupFiles(freshStore()); const target = files.find(file => file.path === 'patients.json'); assert.ok(target); target!.bytes[0] = target!.bytes[0] ^ 1; assert.equal((await verifyPsychologyBackupFiles(files)).intact, false); });
test('R2B1 backup 20 — não aceita ZIP inválido', async () => assert.equal((await verifyPsychologyBackupZip(new Uint8Array([1, 2, 3]))).intact, false));

// Dry-run and safety: 21–30
test('R2B1 dry-run 21 — separa contagens administrativas e clínicas', () => { const result = previewImport(normalizeCsvRows(parseCsvText(csv).rows, csvInput), freshStore()); assert.equal(result.counts.patients, 1); assert.equal(result.clinical, 0); });
test('R2B1 dry-run 22 — sinaliza referência de paciente ausente', () => { const input = { ...csvInput, text: 'entity,id,data,hora\nappointment,a-002,2026-01-16,09:00' }; const bundle = normalizeCsvRows(parseCsvText(input.text!).rows, input); assert.equal(bundle.conflicts.some(item => item.type === 'missing_patient_reference'), true); });
test('R2B1 dry-run 23 — sinaliza data inválida', () => { const input = { ...csvInput, text: 'entity,id,data,hora,paciente_id\nappointment,a-003,31/02/2026,09:00,p-001' }; const bundle = normalizeCsvRows(parseCsvText(input.text!).rows, input); assert.equal(bundle.conflicts.some(item => item.type === 'invalid_date'), true); });
test('R2B1 dry-run 24 — sinaliza horário inválido', () => { const input = { ...csvInput, text: 'entity,id,data,hora,paciente_id\nappointment,a-004,2026-01-16,25:00,p-001' }; const bundle = normalizeCsvRows(parseCsvText(input.text!).rows, input); assert.equal(bundle.conflicts.some(item => item.type === 'invalid_time'), true); });
test('R2B1 dry-run 25 — não vincula por nome sozinho', () => { const bundle = createEmptyImportBundle('csv', 'nome.csv'); bundle.patients.push({ name: 'Paciente Sintético', source: 'csv', sourceRecordId: 'p-name' }); const result = deduplicatePsychologyBundle(bundle, freshStore()); assert.equal(result.signals.length, 0); });
test('R2B1 dry-run 26 — sinaliza possível duplicidade com segundo fator', () => { const bundle = createEmptyImportBundle('csv', 'dup.csv'); bundle.patients.push({ name: 'Paciente Sintético', birthDate: '1990-05-10', source: 'csv', sourceRecordId: 'p-dup' }); const result = deduplicatePsychologyBundle(bundle, freshStore()); assert.equal(result.conflicts.some(item => item.type === 'possible_duplicate_patient'), true); });
test('R2B1 dry-run 27 — mantém anexo sem vínculo', () => { const bundle = createEmptyImportBundle('csv', 'anexo.csv'); bundle.attachments.push({ ownerType: 'unknown', fileName: 'arquivo.pdf', source: 'csv', sourceRecordId: 'a-1' }); assert.equal(previewImport(bundle).unlinkedAttachments, 1); });
test('R2B1 dry-run 28 — marca simulação como não persistida', () => assert.equal(runPsychologyDryRun(normalizeCsvRows(parseCsvText(csv).rows, csvInput), freshStore()).persisted, false));
test('R2B1 dry-run 29 — preserva store durante simulação', () => { const store = freshStore(); const before = JSON.stringify(store); runPsychologyDryRun(normalizeCsvRows(parseCsvText(csv).rows, csvInput), store); assert.equal(JSON.stringify(store), before); });
test('R2B1 dry-run 30 — reporta conflitos no dry-run', () => { const input = { ...csvInput, text: 'entity,id,data,hora\nappointment,a-005,2026-01-16,25:00' }; const result = runPsychologyDryRun(normalizeCsvRows(parseCsvText(input.text!).rows, input), freshStore()); assert.ok(result.conflicts > 0); });

// Export and adapters: 31–40
test('R2B1 export 31 — backup sintético tem paciente', () => assert.equal(freshStore().patients[0]?.name, 'Paciente Sintético'));
test('R2B1 export 32 — backup sintético tem sessão', () => assert.equal(freshStore().sessions.length, 1));
test('R2B1 export 33 — backup sintético tem compromisso pessoal', () => assert.equal(freshStore().personalCommitments.length, 1));
test('R2B1 export 34 — backup sintético tem registro clínico separado', () => assert.equal(freshStore().sessionRecords.length, 1));
test('R2B1 export 35 — adaptador de backup reconhece ZIP', async () => { const bytes = await createPsychologyBackupZip(freshStore()); assert.equal(new GestaoClinicaBackupAdapter().recognize({ source: 'gestao-clinica-backup', fileName: 'backup.zip', bytes }).recognized, true); });
test('R2B1 export 36 — adaptador Doctoralia não inventa formato', () => assert.equal(new DoctoraliaImportAdapter().recognize({ source: 'doctoralia', fileName: 'export.csv', text: 'qualquer' }).message, DOCTORALIA_UNRECOGNIZED_MESSAGE));
test('R2B1 export 37 — backup não inclui segredo', async () => { const files = await buildPsychologyBackupFiles(freshStore()); assert.equal(files.some(file => new TextDecoder().decode(file.bytes).includes('password')), false); });
test('R2B1 export 38 — fileCount corresponde ao ZIP lógico', async () => { const files = await buildPsychologyBackupFiles(freshStore()); const manifest = JSON.parse(new TextDecoder().decode(files[0].bytes)); assert.equal(manifest.fileCount, files.length); });
test('R2B1 export 39 — backup vazio também é verificável', async () => assert.equal((await verifyPsychologyBackupZip(await createPsychologyBackupZip({ ...freshStore(), patients: [], sessions: [], personalCommitments: [], sessionRecords: [] }))).intact, true));
test('R2B1 export 40 — fonte de backup é sintética', async () => { const files = await buildPsychologyBackupFiles(freshStore()); const manifest = JSON.parse(new TextDecoder().decode(files[0].bytes)); assert.equal(manifest.source, 'psychology-local-synthetic'); });

// UI contract: 41–50
const importUi = readFileSync('src/features/psychology-import-export/PsychologyImportExport.tsx', 'utf8');
const importTypes = readFileSync('src/features/psychology-import-export/types.ts', 'utf8');
const pilotUi = readFileSync('src/features/psychology-pilot/PsychologyPilot.tsx', 'utf8');
test('R2B1 UI 41 — título da central existe', () => assert.match(importUi, /Importar e exportar dados/));
test('R2B1 UI 42 — bloco de importar existe', () => assert.match(importUi, /Importar dados/));
test('R2B1 UI 43 — bloco de exportar existe', () => assert.match(importUi, /Exportar \/ Fazer backup/));
test('R2B1 UI 44 — bloco de verificar existe', () => assert.match(importUi, /Verificar backup/));
test('R2B1 UI 45 — fonte Doctoralia existe', () => assert.match(importTypes, /Doctoralia/));
test('R2B1 UI 46 — fonte CSV existe', () => assert.match(importTypes, /Planilha CSV\/XLS\/XLSX/));
test('R2B1 UI 47 — simulação existe', () => assert.match(importUi, /Simular importação/));
test('R2B1 UI 48 — importação real fica desabilitada', () => { assert.match(importUi, /REAL_IMPORT_DISABLED_MESSAGE/); assert.match(importTypes, new RegExp(REAL_IMPORT_DISABLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); });
test('R2B1 UI 49 — central está dentro de Ajustes', () => assert.match(pilotUi, /<PsychologyImportExport store=\{store\}/));
test('R2B1 UI 50 — escopo local é informado', () => assert.match(importUi, /sem Firebase\/Firestore/));
