import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import PublicBookingAvailabilityEditor from '../src/features/psychology-online-booking/PublicBookingAvailabilityEditor';
import {
  createDefaultPublicBookingSettings,
  createPublicBookingException,
  getPublishedSlots,
  normalizePublicBookingSettings,
  PUBLIC_BOOKING_START_GRID_MINUTES,
} from '../src/features/psychology-online-booking/bookingDomain';
import { createLocalPublicBookingRepository, createMemoryOnlineBookingStorage } from '../src/features/psychology-online-booking/repository';
import { createMemoryPublicBookingServerStore, createServerPublicBookingRepository } from '../src/features/psychology-online-booking/publicServerRepository';
import type { BookingBlock, PublicBookingAvailabilityPeriod, PublicBookingException, PublicBookingModality, PublicBookingSettings } from '../src/features/psychology-online-booking/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = new Date('2026-01-01T08:00:00');
const monday = '2026-01-05';
const saturday = '2026-01-10';

function syntheticSettings(): PublicBookingSettings {
  return { ...createDefaultPublicBookingSettings(now), minNoticeHours: 0, maxAdvanceDays: 90, slotIntervalMinutes: 30, publicBookingAvailability: [], publicBookingExceptions: [] };
}

function publicPeriod(dayOfWeek: number, startTime: string, endTime: string, modalities: PublicBookingModality[] = ['ONLINE', 'PRESENCIAL']): PublicBookingAvailabilityPeriod {
  const settings = syntheticSettings();
  return { dayOfWeek, enabled: true, startTime, endTime, modalities, locationIds: settings.locations.map(location => location.id) };
}

function settingsWithPeriods(periods: PublicBookingAvailabilityPeriod[], exceptions: PublicBookingException[] = [], weeklyAvailability = syntheticSettings().weeklyAvailability): PublicBookingSettings {
  return { ...syntheticSettings(), weeklyAvailability, publicBookingAvailability: periods, publicBookingExceptions: exceptions };
}

function slotTimes(settings: PublicBookingSettings, date: string, existingBlocks: BookingBlock[] = [], modality: 'ONLINE' | 'PRESENCIAL' = 'ONLINE') {
  return getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality, locationId: modality === 'PRESENCIAL' ? settings.locations[0].id : undefined, fromDate: date, throughDate: date, now, existingBlocks }).map(slot => slot.time);
}

test('R109 usa grade pública canônica de 60 minutos, arredondando o primeiro início para cima', () => {
  assert.equal(PUBLIC_BOOKING_START_GRID_MINUTES, 60);
  assert.deepEqual(slotTimes(settingsWithPeriods([publicPeriod(1, '10:00', '17:00')]), monday), ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
  assert.deepEqual(slotTimes(settingsWithPeriods([publicPeriod(1, '14:30', '17:00')]), monday), ['15:00', '16:00']);
  assert.deepEqual(slotTimes(settingsWithPeriods([publicPeriod(1, '14:00', '16:30')]), monday), ['14:00', '15:00']);
  assert.deepEqual(slotTimes(settingsWithPeriods([publicPeriod(1, '09:15', '12:15')]), monday), ['10:00', '11:00']);
});

test('R109 preserva múltiplos períodos, duração de 50 minutos e nenhum início fora da hora', () => {
  const settings = settingsWithPeriods([publicPeriod(1, '08:00', '12:00'), publicPeriod(1, '14:00', '18:00')]);
  const slots = getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: monday, throughDate: monday, now });
  assert.deepEqual(slots.map(slot => slot.time), ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']);
  assert.ok(slots.every(slot => slot.durationMinutes === 50 && slot.time.endsWith(':00')));
  assert.equal(slots.filter(slot => !slot.time.endsWith(':00')).length, 0);
});

test('R109 trata dia bloqueado, período bloqueado, período extra e sobreposição parcial', () => {
  const dayBlocked = settingsWithPeriods([publicPeriod(1, '08:00', '18:00')], [createPublicBookingException({ professionalId: 'synthetic', civilDate: monday, type: 'BLOCK_DAY', now })]);
  assert.deepEqual(slotTimes(dayBlocked, monday), []);

  const periodBlocked = settingsWithPeriods([publicPeriod(1, '08:00', '18:00')], [createPublicBookingException({ professionalId: 'synthetic', civilDate: monday, type: 'BLOCK_PERIOD', startTime: '13:00', endTime: '16:00', now })]);
  assert.deepEqual(slotTimes(periodBlocked, monday), ['08:00', '09:00', '10:00', '11:00', '12:00', '16:00', '17:00']);

  const extra = settingsWithPeriods([], [createPublicBookingException({ professionalId: 'synthetic', civilDate: saturday, type: 'OPEN_PERIOD', startTime: '14:30', endTime: '18:00', now })]);
  assert.deepEqual(slotTimes(extra, saturday), ['15:00', '16:00', '17:00']);

  const partial = settingsWithPeriods([publicPeriod(1, '14:00', '18:00')], [createPublicBookingException({ professionalId: 'synthetic', civilDate: monday, type: 'BLOCK_PERIOD', startTime: '14:20', endTime: '14:40', now })]);
  assert.deepEqual(slotTimes(partial, monday), ['15:00', '16:00', '17:00']);
});

test('R109 mantém publicBookingAvailability como fonte pública quando weeklyAvailability diverge', () => {
  const weeklyOnlyMorning = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, enabled: dayOfWeek === 1, periods: dayOfWeek === 1 ? [{ startTime: '08:00', endTime: '09:00' }] : [] }));
  const settings = settingsWithPeriods([publicPeriod(1, '14:30', '18:00')], [], weeklyOnlyMorning);
  assert.deepEqual(slotTimes(settings, monday), ['15:00', '16:00', '17:00']);
});

test('R109 filtra a disponibilidade por modalidade em cada período, incluindo AMBOS', () => {
  const settings = settingsWithPeriods([
    publicPeriod(1, '08:00', '12:00', ['PRESENCIAL']),
    publicPeriod(1, '14:00', '18:00', ['ONLINE']),
    publicPeriod(3, '09:00', '13:00', ['ONLINE', 'PRESENCIAL']),
  ]);
  assert.deepEqual(slotTimes(settings, monday, [], 'ONLINE'), ['14:00', '15:00', '16:00', '17:00']);
  assert.deepEqual(slotTimes(settings, monday, [], 'PRESENCIAL'), ['08:00', '09:00', '10:00', '11:00']);
  assert.deepEqual(slotTimes(settings, '2026-01-07', [], 'ONLINE'), ['09:00', '10:00', '11:00', '12:00']);
  assert.deepEqual(slotTimes(settings, '2026-01-07', [], 'PRESENCIAL'), ['09:00', '10:00', '11:00', '12:00']);
});

test('R109 aplica a interseção entre modalidade do período, serviço e modalidades publicadas', () => {
  const settings = settingsWithPeriods([publicPeriod(1, '10:00', '13:00', ['ONLINE', 'PRESENCIAL'])]);
  const onlineOnly = { ...settings, publishedServices: settings.publishedServices.map(service => service.id === 'psychotherapy-individual' ? { ...service, onlineEnabled: true, inPersonEnabled: false } : service) };
  assert.deepEqual(slotTimes(onlineOnly, monday, [], 'ONLINE'), ['10:00', '11:00', '12:00']);
  assert.deepEqual(slotTimes(onlineOnly, monday, [], 'PRESENCIAL'), []);

  const localA = settings.locations[0].id;
  const localB = settings.locations[1].id;
  const localRestrictedPeriod = { ...publicPeriod(1, '10:00', '13:00', ['PRESENCIAL']), locationIds: [localA] };
  const localRestricted = { ...settings, publicBookingAvailability: [localRestrictedPeriod] };
  assert.deepEqual(getPublishedSlots({ settings: localRestricted, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: localA, fromDate: monday, throughDate: monday, now }).map(slot => slot.time), ['10:00', '11:00', '12:00']);
  assert.deepEqual(getPublishedSlots({ settings: localRestricted, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: localB, fromDate: monday, throughDate: monday, now }), []);
});

test('R109 aplica modalidade também nas exceções OPEN_PERIOD sem bloquear a rotina da outra modalidade', () => {
  const exceptionDate = '2026-01-07';
  const extraPresential = createPublicBookingException({ professionalId: 'synthetic', civilDate: exceptionDate, type: 'OPEN_PERIOD', startTime: '14:00', endTime: '17:00', modality: 'PRESENCIAL', now });
  const settings = settingsWithPeriods([publicPeriod(3, '09:00', '13:00', ['ONLINE'])], [extraPresential]);
  assert.deepEqual(slotTimes(settings, exceptionDate, [], 'ONLINE'), ['09:00', '10:00', '11:00', '12:00']);
  assert.deepEqual(slotTimes(settings, exceptionDate, [], 'PRESENCIAL'), ['14:00', '15:00', '16:00']);
});

test('R109 normaliza período legado sem modalities usando as modalidades públicas ativas', () => {
  const legacy = { ...syntheticSettings(), publicBookingAvailability: [{ dayOfWeek: 1, enabled: true, startTime: '10:00', endTime: '13:00' } as unknown as PublicBookingAvailabilityPeriod] };
  const normalized = normalizePublicBookingSettings(legacy, now);
  assert.deepEqual(normalized.publicBookingAvailability[0]?.modalities, ['ONLINE', 'PRESENCIAL']);
});

test('R109 preserva conflitos de sessão, compromisso pessoal, reserva pública e hold', () => {
  const settings = settingsWithPeriods([publicPeriod(1, '14:00', '18:00')]);
  for (const source of ['session', 'personal', 'public-booking', 'hold'] as const) {
    const slots = slotTimes(settings, monday, [{ date: monday, startTime: '15:00', durationMinutes: 50, source }]);
    assert.deepEqual(slots, ['14:00', '16:00', '17:00'], source);
  }
});

test('R109 preserva modalidade presencial, local válido e duração de cada serviço canônico', () => {
  const settings = settingsWithPeriods([publicPeriod(1, '10:00', '13:00')]);
  assert.equal(settings.publishedServices.length, 5);
  for (const service of settings.publishedServices) {
    assert.equal(service.durationMinutes, 50, service.id);
    const slots = getPublishedSlots({ settings, serviceId: service.id, modality: 'PRESENCIAL', locationId: settings.locations[0].id, fromDate: monday, throughDate: monday, now });
    assert.deepEqual(slots.map(slot => slot.time), ['10:00', '11:00', '12:00'], service.id);
  }
  assert.equal(getPublishedSlots({ settings, serviceId: 'psychotherapy-individual', modality: 'PRESENCIAL', locationId: 'invalid-location', fromDate: monday, throughDate: monday, now }).length, 0);
});

test('R109 persiste rotina e exceções em storage sintético e libera horário após cancelamento', async () => {
  const storage = createMemoryOnlineBookingStorage();
  const repository = createLocalPublicBookingRepository({ storage, now: () => new Date(now) });
  const initial = await repository.getSettings('leila-chaves');
  assert.ok(initial);
  if (!initial) return;
  const period = publicPeriod(1, '14:30', '18:00');
  const exception = createPublicBookingException({ professionalId: initial.professionalId, civilDate: monday, type: 'BLOCK_PERIOD', startTime: '16:00', endTime: '17:00', now });
  await repository.updateSettings({ publicBookingAvailability: [period], publicBookingExceptions: [exception] });
  const refreshed = await createLocalPublicBookingRepository({ storage, now: () => new Date(now) }).getSettings('leila-chaves');
  assert.deepEqual(refreshed?.publicBookingAvailability.map(item => [item.startTime, item.endTime]), [['14:30', '18:00']]);
  assert.deepEqual(refreshed?.publicBookingAvailability[0]?.modalities, ['ONLINE', 'PRESENCIAL']);
  assert.equal(refreshed?.publicBookingExceptions[0]?.type, 'BLOCK_PERIOD');
  const persistedSlots = await repository.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: monday, throughDate: monday });
  assert.deepEqual(persistedSlots.map(slot => slot.time), ['15:00', '17:00']);

  const booking = await repository.createBooking({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', date: monday, time: '15:00', name: 'Paciente sintético R109', dateOfBirth: '1990-01-01', phone: '27999990000', email: 'r109-synthetic@example.test' });
  assert.equal('appointment' in booking, true);
  if (!('appointment' in booking)) return;
  assert.deepEqual((await repository.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: monday, throughDate: monday })).map(slot => slot.time), ['17:00']);
  await repository.cancelByManagementToken(booking.managementToken, new Date('2026-01-02T08:00:00'));
  assert.deepEqual((await repository.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: monday, throughDate: monday })).map(slot => slot.time), ['15:00', '17:00']);
});

test('R109 sincroniza a mesma configuração para o repositório público em memória', async () => {
  const settings = syntheticSettings();
  const store = createMemoryPublicBookingServerStore(settings, now);
  const repository = createServerPublicBookingRepository({ state: store.getState(), now: () => new Date(now) });
  await repository.updateSettings({ publicBookingAvailability: [publicPeriod(1, '14:30', '18:00')] });
  const synced = await repository.getSettings('leila-chaves');
  assert.deepEqual(synced?.publicBookingAvailability.map(item => [item.startTime, item.endTime]), [['14:30', '18:00']]);
  const slots = await repository.listPublishedSlots({ professionalSlug: 'leila-chaves', serviceId: 'psychotherapy-individual', modality: 'ONLINE', fromDate: monday, throughDate: monday });
  assert.deepEqual(slots.map(slot => slot.time), ['15:00', '16:00', '17:00']);
});

function textContent(node: TestRenderer.ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : textContent(child as TestRenderer.ReactTestInstance)).join('');
}

function findButton(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(button => textContent(button).trim() === label);
}

function findInput(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('input').find(input => input.props['aria-label'] === label);
}

function flushAsyncState(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function EditorHarness({ initial, saved }: { initial: PublicBookingSettings; saved: Array<Partial<PublicBookingSettings>> }) {
  const [settings, setSettings] = React.useState(initial);
  return <PublicBookingAvailabilityEditor settings={settings} onSave={async patch => { saved.push(patch); setSettings(current => ({ ...current, ...patch })); }} />;
}

test('R109 editor real permite editar dia, múltiplos períodos, bloquear, liberar e resetar rotina', async () => {
  const initial = { ...syntheticSettings(), publicBookingAvailability: [publicPeriod(1, '09:00', '12:00')] };
  const saved: Array<Partial<PublicBookingSettings>> = [];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<EditorHarness initial={initial} saved={saved} />); });

  await act(async () => { findButton(renderer, 'Editar')?.props.onClick(); });
  const mondayEditor = renderer.root.findByProps({ 'data-testid': 'psychology-availability-day-editor-1' });
  const activeCheckbox = mondayEditor.findAllByType('input').find(input => input.props.type === 'checkbox');
  await act(async () => { activeCheckbox?.props.onChange({ target: { checked: false } }); });
  await act(async () => { findButton(renderer, 'Salvar dia')?.props.onClick(); await flushAsyncState(); });
  const disabledRoutine = saved.at(-1)?.publicBookingAvailability?.find(period => period.dayOfWeek === 1);
  assert.equal(disabledRoutine?.enabled, false);

  const configureButtons = renderer.root.findAllByType('button').filter(button => textContent(button).trim() === 'Configurar');
  await act(async () => { configureButtons[1]?.props.onClick(); });
  const reenabledEditor = renderer.root.findByProps({ 'data-testid': 'psychology-availability-day-editor-1' });
  const reenabledCheckbox = reenabledEditor.findAllByType('input').find(input => input.props.type === 'checkbox');
  await act(async () => { reenabledCheckbox?.props.onChange({ target: { checked: true } }); });
  await act(async () => { findInput(renderer, 'Segunda-feira período 1 Online')?.props.onChange({ target: { checked: false } }); });
  await act(async () => { findButton(renderer, '+ Adicionar período')?.props.onClick(); });
  await act(async () => { findInput(renderer, 'Segunda-feira período 2 Presencial')?.props.onChange({ target: { checked: false } }); });
  await act(async () => { findInput(renderer, 'Segunda-feira período 2 Online')?.props.onChange({ target: { checked: true } }); });
  await act(async () => { findButton(renderer, 'Salvar dia')?.props.onClick(); await flushAsyncState(); });
  assert.deepEqual(saved.at(-1)?.publicBookingAvailability?.filter(period => period.dayOfWeek === 1).map(period => period.modalities), [['PRESENCIAL'], ['ONLINE']]);
  assert.match(textContent(renderer.root), /Seg 09:00–12:00 · Presencial · 13:00–17:00 · Online/);

  await act(async () => { findButton(renderer, 'EXCEÇÕES POR DATA')?.props.onClick(); });
  const dateButton = renderer.root.findAllByType('button').find(button => /^\d{4}-\d{2}-\d{2} · NORMAL$/.test(String(button.props['aria-label'] || '')));
  assert.ok(dateButton);
  await act(async () => { dateButton?.props.onClick(); });
  await act(async () => { findInput(renderer, 'Modalidade do ajuste Online')?.props.onChange({ target: { checked: false } }); });
  await act(async () => { findButton(renderer, 'Bloquear período')?.props.onClick(); await flushAsyncState(); });
  assert.equal(saved.at(-1)?.publicBookingExceptions?.at(-1)?.type, 'BLOCK_PERIOD');
  assert.equal(saved.at(-1)?.publicBookingExceptions?.at(-1)?.modality, 'PRESENCIAL');
  await act(async () => { findButton(renderer, 'Bloquear dia inteiro')?.props.onClick(); await flushAsyncState(); });
  assert.equal(saved.at(-1)?.publicBookingExceptions?.at(-1)?.type, 'BLOCK_DAY');
  await act(async () => { findButton(renderer, 'Liberar horário extra')?.props.onClick(); await flushAsyncState(); });
  assert.equal(saved.at(-1)?.publicBookingExceptions?.at(-1)?.type, 'OPEN_PERIOD');
  await act(async () => { findButton(renderer, 'Usar programação habitual')?.props.onClick(); await flushAsyncState(); });
  assert.equal(saved.at(-1)?.publicBookingExceptions?.length, 0);
  await act(async () => { renderer.unmount(); });
});

test('R109 editor impede salvar período ativo sem modalidade e não persiste o estado inválido', async () => {
  const initial = { ...syntheticSettings(), publicBookingAvailability: [publicPeriod(1, '09:00', '12:00')] };
  const saved: Array<Partial<PublicBookingSettings>> = [];
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<EditorHarness initial={initial} saved={saved} />); });
  await act(async () => { findButton(renderer, 'Editar')?.props.onClick(); });
  await act(async () => { findInput(renderer, 'Segunda-feira período 1 Online')?.props.onChange({ target: { checked: false } }); });
  await act(async () => { findInput(renderer, 'Segunda-feira período 1 Presencial')?.props.onChange({ target: { checked: false } }); });
  await act(async () => { findButton(renderer, 'Salvar dia')?.props.onClick(); await flushAsyncState(); });
  assert.equal(saved.length, 0);
  assert.match(textContent(renderer.root), /Selecione Online, Presencial ou ambos para este período\./);
  await act(async () => { renderer.unmount(); });
});
