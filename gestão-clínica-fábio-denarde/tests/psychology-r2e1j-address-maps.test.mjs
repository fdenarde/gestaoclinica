import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const page = await readFile(resolve(root, 'src/features/psychology-online-booking/PublicBookingPage.tsx'), 'utf8');
const management = await readFile(resolve(root, 'src/features/psychology-online-booking/AppointmentManagementPage.tsx'), 'utf8');
const locationDetails = await readFile(resolve(root, 'src/features/psychology-online-booking/PublicBookingLocationDetails.tsx'), 'utf8');
const pilot = await readFile(resolve(root, 'src/features/psychology-pilot/PsychologyPilot.tsx'), 'utf8');
const domain = await readFile(resolve(root, 'src/features/psychology-pilot/psychologyDomain.ts'), 'utf8');

test('confirmação presencial usa o local canônico e oferece Maps/cópia sem expor a URL', () => {
  assert.match(page, /success\.appointment\.modality === 'PRESENCIAL'/);
  assert.match(page, /<PublicBookingLocationDetails location=\{confirmedLocation\}/);
  assert.match(page, /selectedLocation\.fullAddress &&/);
  assert.match(page, /Abrir no Google Maps/);
  assert.doesNotMatch(page, /selectedLocation\.fullAddress \|\| `\$\{selectedLocation\.city/);
  assert.match(locationDetails, /navigator\.clipboard\?\.writeText/);
  assert.match(locationDetails, /data-testid="public-booking-open-maps"/);
  assert.match(locationDetails, /data-testid="public-booking-copy-address"/);
  assert.match(locationDetails, /copyText\(fullAddress\)/);
  assert.match(locationDetails, /href=\{googleMapsUrl\}/);
});

test('online não renderiza dados de localização e management link reaproveita o bloco seguro', () => {
  assert.match(page, /modality === 'ONLINE' \? 'Online'/);
  assert.match(page, /confirmedLocation = success\.appointment\.modality === 'PRESENCIAL'/);
  assert.match(page, /Tipo de atendimento/);
  assert.match(page, /modality === 'ONLINE' \? 'Online' : 'Presencial'/);
  assert.match(management, /managementLocation = summary\.modality === 'PRESENCIAL'/);
  assert.match(management, /Tipo de atendimento/);
  assert.match(management, /summary\.modality === 'ONLINE' \? 'Online' : 'Presencial'/);
  assert.doesNotMatch(management, /summary\.modality === 'ONLINE' \? 'Online' : summary\.locationName/);
  assert.match(management, /<PublicBookingLocationDetails location=\{managementLocation\}/);
  assert.doesNotMatch(management, /summary\.googleMapsUrl.*https?:\/\//);
});

test('Ajustes mantém endereço/Maps no cadastro canônico e valida URL antes de salvar', () => {
  for (const field of ['fullAddress', 'city', 'state', 'googleMapsUrl', 'sortOrder']) assert.match(pilot, new RegExp(field));
  assert.match(pilot, /isValidGoogleMapsUrl\(googleMapsUrl\)/);
  assert.match(pilot, /Complete o endereço para exibi-lo ao paciente/);
  assert.match(domain, /fullAddress: input\.fullAddress/);
  assert.match(domain, /googleMapsUrl: input\.googleMapsUrl/);
});
