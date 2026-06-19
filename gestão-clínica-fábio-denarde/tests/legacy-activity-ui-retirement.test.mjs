import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync('src/App.tsx', 'utf8');
const patientsSource = fs.readFileSync('src/components/Patients.tsx', 'utf8');
const agendaSource = fs.readFileSync('src/components/Agenda.tsx', 'utf8');
const dashboardSource = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');
const gallerySource = fs.readFileSync('src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', 'utf8');

const activeUiSource = [appSource, patientsSource, agendaSource, dashboardSource].join('\n');

test('botão do card do atendente abre a nova Galeria de Atividades do atendente específico', () => {
  assert.match(patientsSource, /onNavigateToPatientGallery\?\.\(patient\.id\)/);
  assert.match(patientsSource, /Abrir Galeria de Atividades de \$\{patient\.name\}/);
  assert.doesNotMatch(patientsSource, /handleQuickActivity/);
  assert.doesNotMatch(patientsSource, /<ActivityRecordModal/);
});

test('atalhos da Agenda convergem para a mesma galeria sem abrir o modal antigo', () => {
  assert.match(agendaSource, /handleOpenActivityGallery/);
  assert.match(agendaSource, /onNavigateToPatientGallery\(patient\.id\)/);
  assert.match(agendaSource, /Abrir Galeria de Atividades/);
  assert.doesNotMatch(agendaSource, /ActivityRecordModal/);
  assert.doesNotMatch(agendaSource, /Registrar atividade/);
  assert.doesNotMatch(agendaSource, /Ver Galeria de Mídias/);
});

test('atalho explícito transporta somente o patientId e abre o pacote sob demanda', () => {
  assert.match(appSource, /const openActivityGallery = \(patientId: string \| null = null\)/);
  assert.match(appSource, /setSelectedGalleryPatientId\(patientId\)/);
  assert.match(appSource, /initialPatientId=\{selectedGalleryPatientId\}/);
  assert.match(gallerySource, /initialPatientId\?: string \| null/);
  assert.match(gallerySource, /useState\(\(\) => String\(initialPatientId \|\| ''\)\.trim\(\)\)/);
});

test('entrada pelo menu continua sem selecionar atendente automaticamente', () => {
  assert.match(appSource, /if \(id === 'galeria-atividades'\)[\s\S]*setSelectedGalleryPatientId\(null\)/);
  assert.match(gallerySource, /Selecione o atendente/);
});

test('aba e modal antigos ficam ocultos da interface ativa, mas os arquivos históricos são preservados', () => {
  assert.doesNotMatch(activeUiSource, /ProfessionalActivityGallery/);
  assert.doesNotMatch(activeUiSource, /ActivityRecordsTab/);
  assert.doesNotMatch(activeUiSource, /ActivityRecordModal/);
  assert.doesNotMatch(patientsSource, /fullLabel: 'Registros de Atividades'/);
  assert.ok(fs.existsSync('src/components/ActivityRecords/ProfessionalActivityGallery.tsx'));
  assert.ok(fs.existsSync('src/components/ActivityRecords/ActivityRecordsTab.tsx'));
  assert.ok(fs.existsSync('src/components/ActivityRecords/ActivityRecordModal.tsx'));
  assert.ok(fs.existsSync('api/activity-records.js'));
});

test('notificações antigas não carregam nem reproduzem mídia legada automaticamente', () => {
  assert.doesNotMatch(appSource, /getActivityPhotoUrl/);
  assert.doesNotMatch(appSource, /notificationMediaUrl/);
  assert.doesNotMatch(appSource, /Mídia acessada pelo responsável/);
  assert.match(appSource, /navigateToPatientGallery\(notification\.patientId\)/);
});

test('dashboard não mantém indicador de upload da galeria antiga', () => {
  assert.doesNotMatch(dashboardSource, /activityUploadLateSessionCount/);
  assert.doesNotMatch(dashboardSource, /upload de mídia atrasado/);
  assert.doesNotMatch(dashboardSource, /registrar as mídias ou justificar/);
});

test('mudança de interface não contém exclusão ou limpeza de dados históricos', () => {
  assert.doesNotMatch(activeUiSource, /deleteActivity|removeActivity|purgeActivity|cleanupActivity/i);
  assert.match(patientsSource, /registros históricos de atividades preservados/);
});
