import { getWhatsappReminderPlan as getTypedWhatsappReminderPlan } from '../src/lib/utils';
import { getWhatsappReminderPlan as getSharedWhatsappReminderPlan } from '../src/lib/whatsappReminderPlan.js';
import type { ClinicSettings, Patient, Session } from '../src/types';

type ReminderType = 'AMANHA' | 'HOJE_MANHA' | 'HOJE_TARDE';

const baseSettings: ClinicSettings = {
  name: 'Clinica Teste',
  specialty: 'Teste',
  title: 'Teste',
  email: 'teste@example.com',
  whatsapp: '(27) 99999-0000',
  address: 'Endereco de teste',
  holidays: []
};

function patient(overrides: Partial<Patient>): Patient {
  return {
    id: 'patient-default',
    name: 'Paciente Ficticio',
    birthDate: '2018-01-01',
    guardianName: 'Responsavel Ficticio',
    whatsapp: '(27) 99999-0001',
    fixedDay: 'segunda',
    fixedTime: '09:00',
    paymentModal: 'PADRAO' as any,
    startDate: '2026-01-01',
    anamnese: {
      complaint: '',
      school: '',
      grade: '',
      referredBy: '',
      diagnoses: '',
      initialNotes: ''
    },
    clinicalNotes: '',
    status: 'Ativo',
    ...overrides
  };
}

function session(overrides: Partial<Session>): Session {
  return {
    id: 'session-default',
    patientId: 'patient-default',
    date: '2026-06-01',
    time: '09:00',
    type: 'Sessão simples (50 min)' as any,
    status: 'Agendada' as any,
    notes: '',
    packageNumber: 1,
    ...overrides
  };
}

function plan({
  runDateStr = '2026-06-01',
  tipo,
  patients,
  sessions = [],
  settings = baseSettings
}: {
  runDateStr?: string;
  tipo: ReminderType;
  patients: Patient[];
  sessions?: Session[];
  settings?: ClinicSettings;
}) {
  const sharedPlan = getSharedWhatsappReminderPlan({ runDateStr, tipo, patients, sessions, settings });
  const typedPlan = getTypedWhatsappReminderPlan({ runDateStr, tipo, patients, sessions, settings });
  assert(
    JSON.stringify(sharedPlan) === JSON.stringify(typedPlan),
    `Modulo compartilhado divergiu da logica atual do frontend para ${tipo} em ${runDateStr}`
  );
  return sharedPlan as ReturnType<typeof getTypedWhatsappReminderPlan>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertReminderIds(actual: ReturnType<typeof getTypedWhatsappReminderPlan>, expectedIds: string[], label: string) {
  const actualIds = actual.reminders.map(reminder => reminder.patientId).sort();
  const expected = [...expectedIds].sort();
  assert(
    JSON.stringify(actualIds) === JSON.stringify(expected),
    `${label}: esperado ${expected.join(', ') || '(nenhum)'}, recebido ${actualIds.join(', ') || '(nenhum)'}`
  );
}

function assertDiagnosticReason(actual: ReturnType<typeof getTypedWhatsappReminderPlan>, reason: string, label: string) {
  assert(
    actual.diagnostics.some(item => item.blockedReason === reason),
    `${label}: diagnostico nao encontrado: ${reason}`
  );
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'bloqueia todos os lembretes quando a data alvo e feriado/recesso',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [patient({ id: 'p-feriado' })],
        settings: {
          ...baseSettings,
          holidays: [{ id: 'h1', date: '2026-06-01', name: 'Feriado Teste' }]
        }
      });

      assert(result.isHoliday, 'feriado deveria bloquear a rotina');
      assert(result.reminders.length === 0, 'feriado nao pode gerar lembretes');
      assertDiagnosticReason(result, 'feriado/recesso (Feriado Teste)', 'feriado');
    }
  },
  {
    name: 'envia HOJE_MANHA somente para sessoes antes de 12h',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [
          patient({ id: 'p-manha', fixedTime: '09:00' }),
          patient({ id: 'p-tarde', fixedTime: '14:00' })
        ]
      });

      assertReminderIds(result, ['p-manha'], 'HOJE_MANHA');
      assertDiagnosticReason(result, 'fora do turno (Sessão da tarde)', 'HOJE_MANHA');
    }
  },
  {
    name: 'envia HOJE_TARDE somente para sessoes a partir de 12h',
    run: () => {
      const result = plan({
        tipo: 'HOJE_TARDE',
        patients: [
          patient({ id: 'p-manha', fixedTime: '09:00' }),
          patient({ id: 'p-tarde', fixedTime: '14:00' })
        ]
      });

      assertReminderIds(result, ['p-tarde'], 'HOJE_TARDE');
      assertDiagnosticReason(result, 'fora do turno (Sessão da manhã)', 'HOJE_TARDE');
    }
  },
  {
    name: 'envia AMANHA para a agenda da data seguinte',
    run: () => {
      const result = plan({
        tipo: 'AMANHA',
        patients: [
          patient({ id: 'p-segunda', fixedDay: 'segunda', fixedTime: '09:00' }),
          patient({ id: 'p-terca', fixedDay: 'terça', fixedTime: '10:00' })
        ]
      });

      assert(result.dateStr === '2026-06-02', 'AMANHA deveria mirar 2026-06-02');
      assertReminderIds(result, ['p-terca'], 'AMANHA');
      assert(result.reminders[0].message.includes('amanhã'), 'mensagem de AMANHA deveria mencionar amanhã');
    }
  },
  {
    name: 'deduplica sessao dupla e envia apenas uma mensagem por paciente',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [patient({ id: 'p-dupla', fixedTime: '08:00', doubleSession: true })]
      });

      assertReminderIds(result, ['p-dupla'], 'sessao dupla');
      assert(result.reminders.length === 1, 'sessao dupla nao pode gerar duas mensagens');
      assertDiagnosticReason(result, 'conflito/deduplicação (Dupla)', 'sessao dupla');
    }
  },
  {
    name: 'bloqueia paciente ativo sem WhatsApp',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [patient({ id: 'p-sem-whatsapp', whatsapp: '' })]
      });

      assertReminderIds(result, [], 'paciente sem WhatsApp');
      assertDiagnosticReason(result, 'paciente sem WhatsApp', 'paciente sem WhatsApp');
    }
  },
  {
    name: 'bloqueia paciente inativo e sessao cancelada',
    run: () => {
      const patients = [
        patient({ id: 'p-inativo', status: 'Concluído' }),
        patient({ id: 'p-cancelada', fixedTime: '10:00' })
      ];
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients,
        sessions: [
          session({ id: 's-cancelada', patientId: 'p-cancelada', time: '10:00', status: 'Cancelada' as any })
        ]
      });

      assertReminderIds(result, [], 'inativo/cancelada');
      assertDiagnosticReason(result, 'sessão cancelada', 'sessao cancelada');
    }
  },
  {
    name: 'bloqueia compromisso manual marcado como bloqueador',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [],
        sessions: [
          session({
            id: 's-bloqueio',
            patientId: '',
            blockName: 'Compromisso Ficticio',
            isBlocked: true
          })
        ]
      });

      assert(result.reminders.length === 0, 'compromisso bloqueador nao pode gerar lembrete');
      assertDiagnosticReason(result, 'sessão manual bloqueadora', 'bloqueio manual');
    }
  },
  {
    name: 'usa sessao manual agendada no lugar da virtual equivalente',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [patient({ id: 'p-manual', fixedTime: '09:00' })],
        sessions: [session({ id: 's-manual', patientId: 'p-manual', time: '09:00' })]
      });

      assert(result.reminders.length === 1, 'deveria gerar um lembrete manual');
      assert(result.reminders[0].id === 's-manual', 'lembrete deveria usar sessao manual existente');
      assert(!result.reminders[0].isVirtual, 'sessao manual nao deveria ser marcada como virtual');
    }
  },
  {
    name: 'formata telefone com codigo do Brasil sem alterar o numero original no lembrete',
    run: () => {
      const result = plan({
        tipo: 'HOJE_MANHA',
        patients: [patient({ id: 'p-phone', whatsapp: '(27) 98888-7777' })]
      });

      assert(result.reminders[0].phone === '5527988887777@c.us', 'telefone deveria ser formatado para whatsapp-web.js');
      assert(result.reminders[0].whatsapp === '(27) 98888-7777', 'telefone original deveria ser preservado no plano');
    }
  }
];

console.log('TESTES OFFLINE DA LOGICA DE WHATSAPP');
console.log('Garantias: nao importa server.js, nao inicializa whatsapp-web.js, nao acessa Firebase e nao envia mensagens.');
console.log('');

let passed = 0;
for (const test of tests) {
  try {
    test.run();
    passed += 1;
    console.log(`OK  ${test.name}`);
  } catch (error) {
    console.error(`FALHA  ${test.name}`);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log('');
  console.log(`Resultado: ${passed}/${tests.length} testes passaram.`);
}
