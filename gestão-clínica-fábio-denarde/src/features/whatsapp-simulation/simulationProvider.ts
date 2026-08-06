import type { SimulationMessageStatus, SimulationTenantId } from './simulationTypes';

export type SimulationProviderName = 'simulation';

export interface SimulationProviderInput {
  provider: string;
  tenantId: SimulationTenantId;
  conversationId: string;
  operationKey: string;
  body: string;
  shouldFail?: boolean;
}

export interface SimulationProviderResult {
  messageId: string;
  operationKey: string;
  status: SimulationMessageStatus;
  time: string;
  duplicate: boolean;
}

export interface SimulationProvider {
  registerMessage(input: SimulationProviderInput): SimulationProviderResult;
  advanceStatus(status: SimulationMessageStatus): SimulationMessageStatus;
  cancelStatus(status: SimulationMessageStatus): SimulationMessageStatus;
}

function normalizeBody(body: string): string {
  return String(body || '').trim();
}

function createSyntheticTime(sequence: number): string {
  const hour = String(9 + (sequence % 8)).padStart(2, '0');
  const minute = String((sequence * 7) % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function nextStatus(status: SimulationMessageStatus): SimulationMessageStatus {
  if (status === 'simulated_queued') return 'simulated_processed';
  if (status === 'simulated_processed') return 'simulated_delivered';
  if (status === 'simulated_delivered') return 'simulated_read';
  return status;
}

function cancelStatus(status: SimulationMessageStatus): SimulationMessageStatus {
  return status === 'simulated_queued' || status === 'simulated_processed'
    ? 'simulated_cancelled'
    : status;
}

export function createSimulationProvider(): SimulationProvider {
  const operations = new Map<string, SimulationProviderResult>();
  let sequence = 0;

  return {
    registerMessage(input) {
      if (input.provider !== 'simulation') {
        throw new Error('Somente o provedor simulation é permitido.');
      }

      const body = normalizeBody(input.body);
      if (!body) throw new Error('A mensagem simulada não pode estar vazia.');
      if (!input.operationKey.trim()) throw new Error('A operação simulada precisa de chave idempotente.');

      const existing = operations.get(input.operationKey);
      if (existing) return { ...existing, duplicate: true };

      sequence += 1;
      const result: SimulationProviderResult = {
        messageId: `SIM-MSG-GERADA-${String(sequence).padStart(3, '0')}`,
        operationKey: input.operationKey,
        status: input.shouldFail ? 'simulated_failed' : 'simulated_queued',
        time: createSyntheticTime(sequence),
        duplicate: false,
      };
      operations.set(input.operationKey, result);
      return { ...result };
    },

    advanceStatus(status) {
      return nextStatus(status);
    },

    cancelStatus(status) {
      return cancelStatus(status);
    },
  };
}
