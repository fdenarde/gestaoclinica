import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery.tsx', import.meta.url),
  'utf8',
);
const identitySource = await readFile(
  new URL('../shared/galleryPatientCards.js', import.meta.url),
  'utf8',
);

test('atendentes são ordenados alfabeticamente sem priorizar sessão do dia', () => {
  assert.match(identitySource, /localeCompare\(right\.name, 'pt-BR', \{ sensitivity: 'base' \}\)/);
  assert.doesNotMatch(identitySource, /left\.hasSessionToday !== right\.hasSessionToday/);
  assert.match(source, /Sessão hoje/);
});

test('cards e cabeçalho usam a foto real do atendente com fallback', () => {
  assert.match(source, /import PatientPhoto from '\.\.\/Common\/PatientPhoto';/);
  assert.match(source, /buildProfessionalGalleryPatientCards/);
  assert.match(identitySource, /photoDriveFileId: normalizeText\(patient\.photoDriveFileId\)/);
  assert.doesNotMatch(identitySource, /fallbackOption\?\.(?:photoUrl|photoDriveFileId)/);
  assert.ok((source.match(/<PatientPhoto/g) || []).length >= 2);
  assert.match(source, /fallbackText=\{initials\}/);
  assert.match(source, /fallbackText=\{selectedPatientInitials\}/);
});

test('foto pode ser ampliada sem selecionar o atendente por engano', () => {
  assert.ok((source.match(/expandable/g) || []).length >= 2);
  assert.match(source, /onClick=\{event => event\.stopPropagation\(\)\}/);
  assert.match(source, /onKeyDown=\{event => event\.stopPropagation\(\)\}/);
  assert.match(source, /aria-label=\{`Abrir galeria de \$\{patient\.name\}`\}/);
});
