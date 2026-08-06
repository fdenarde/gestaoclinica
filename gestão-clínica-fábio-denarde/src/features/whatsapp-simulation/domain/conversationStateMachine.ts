import type {
  SimulationConversation,
  SimulationConversationState,
  SimulationHistoryEntry,
  SimulationTenantId,
} from '../simulationTypes';

const VALID_TRANSITIONS: Record<SimulationConversationState, readonly SimulationConversationState[]> = {
  nova: ['aberta'],
  aberta: ['aguardando_contato', 'finalizada'],
  aguardando_equipe: ['aberta'],
  aguardando_contato: ['aberta'],
  finalizada: ['reaberta'],
  reaberta: ['aberta'],
};

export function canTransitionConversation(
  from: SimulationConversationState,
  to: SimulationConversationState,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertValidConversationTransition(
  from: SimulationConversationState,
  to: SimulationConversationState,
): void {
  if (!canTransitionConversation(from, to)) {
    throw new Error(`Transição inválida: ${from} → ${to}.`);
  }
}

export function createSyntheticHistoryEntry(
  conversation: SimulationConversation,
  tenantId: SimulationTenantId,
  kind: SimulationHistoryEntry['kind'],
  label: string,
  actor: string,
  time: string,
): SimulationHistoryEntry {
  return {
    id: `SIM-HIST-GERADA-${conversation.history.length + 1}`,
    tenantId,
    conversationId: conversation.id,
    kind,
    label,
    actor,
    time,
  };
}

export function transitionConversation(
  conversation: SimulationConversation,
  tenantId: SimulationTenantId,
  nextState: SimulationConversationState,
  actor: string,
  time: string,
): SimulationConversation {
  assertValidConversationTransition(conversation.state, nextState);
  const history = createSyntheticHistoryEntry(
    conversation,
    tenantId,
    'state_changed',
    `Estado alterado para ${nextState}`,
    actor,
    time,
  );
  return {
    ...conversation,
    state: nextState,
    lastActivity: time,
    lastActivityOrder: conversation.lastActivityOrder + 1,
    history: [...conversation.history, history],
  };
}

export function responseStateForConversation(
  conversation: SimulationConversation,
): SimulationConversationState {
  if (conversation.state === 'nova') return 'aberta';
  if (conversation.state === 'aguardando_equipe') return 'aberta';
  return 'aguardando_contato';
}

export function inboundStateForConversation(): SimulationConversationState {
  return 'aguardando_equipe';
}
