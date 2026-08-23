import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWhatsappClickToChatUrl,
  normalizeMetaPhoneRecipient,
  normalizePhone,
  normalizePhoneForComparison,
  normalizePhoneForIntegration,
} from '../shared/phoneNormalization.js';
import { buildMetaMessagesRequest, createMetaWhatsAppSender, MetaConfigurationError } from '../api/_lib/metaCloudApi.js';
import { normalizeBrazilianWhatsappPhone } from '../src/lib/whatsappPhone.js';

const payload = { messaging_product: 'whatsapp', type: 'template', template: { name: 'synthetic', language: { code: 'en_US' } } };
const config = { sendEnabled: 'NO', graphApiVersion: 'v-test', phoneNumberId: 'synthetic', accessToken: 'synthetic-only' };

test('R2B13Z — números brasileiros preservam país explícito sem duplicação', () => {
  assert.equal(normalizePhone("'27999918375").canonicalPhone, '27999918375');
  assert.equal(normalizePhoneForIntegration('(27) 99999-9999', { defaultCountryCode: '55' }).canonicalPhone, '5527999999999');
  assert.equal(normalizePhoneForIntegration("'+55 27 99637-3768").canonicalPhone, '5527996373768');
  assert.equal(normalizeBrazilianWhatsappPhone("'+55 27 99637-3768", { requiredAreaCode: null }).digits, '5527996373768');
  assert.equal(normalizePhoneForComparison('5527996373768'), '5527996373768');
});

test('R2B13Z — Unicode residuals e apóstrofos não chegam à representação canônica', () => {
  const parsed = normalizePhoneForIntegration("\u00A0’+55\u00A0(27)\t99637-3768\n");
  assert.equal(parsed.canonicalPhone, '5527996373768');
  assert.equal(parsed.anomalies.includes('TYPOGRAPHIC_APOSTROPHE'), true);
  assert.equal(parsed.anomalies.includes('UNICODE_SPACE_OR_INVISIBLE'), true);
  assert.throws(() => normalizePhoneForIntegration('++55 27 99637-3768'), error => error.code === 'DOUBLE_PLUS');
});

test('R2B13Z — código internacional estrangeiro é preservado', () => {
  const parsed = normalizePhoneForIntegration('+44 7731 970794');
  assert.equal(parsed.countryCode, '44');
  assert.equal(parsed.canonicalPhone, '447731970794');
  assert.equal(normalizeMetaPhoneRecipient('447731970794').canonicalPhone, '447731970794');
  assert.match(buildWhatsappClickToChatUrl('+44 7731 970794'), /\/447731970794$/);
});

test('R2B13Z — valor inválido é bloqueado antes do transporte Meta', async () => {
  const calls = [];
  const sender = createMetaWhatsAppSender({ transport: { async send(request) { calls.push(request); return { status: 200 }; } } });
  assert.throws(() => buildMetaMessagesRequest({ config, recipient: 'letters-only', payload }), MetaConfigurationError);
  await assert.rejects(sender.send({ config: { ...config, sendEnabled: 'YES' }, recipient: 'letters-only', payload }), MetaConfigurationError);
  assert.equal(calls.length, 0);
});

test('R2B13Z — payload Meta usa somente dígitos canônicos', () => {
  const request = buildMetaMessagesRequest({ config, recipient: '+44 7731 970794', payload });
  const body = JSON.parse(request.body);
  assert.equal(body.to, '447731970794');
  assert.equal(request.body.includes('+44 7731 970794'), false);
});
