import type {
  SimulationClockState,
  SimulationQueueFilters,
  SimulationQueueJob,
  SimulationSchedule,
  SimulationScheduleDraft,
  SimulationScheduleFilters,
  SimulationSchedulePreview,
} from './scheduleTypes';

export type SimulationTenantId = 'SIM-TENANT-A' | 'SIM-TENANT-B';

export type SimulationProfileId =
  | 'platform_admin'
  | 'clinic_admin'
  | 'professional'
  | 'attendant'
  | 'read_only';

export type SimulationConversationState =
  | 'nova'
  | 'aberta'
  | 'aguardando_equipe'
  | 'aguardando_contato'
  | 'finalizada'
  | 'reaberta';

export type SimulationPriority = 'normal' | 'alta';

export type SimulationCategory =
  | 'all'
  | 'unread'
  | 'awaiting_team'
  | 'awaiting_contact'
  | 'scheduled'
  | 'failed'
  | 'finished';

export type SimulationMessageStatus =
  | 'draft'
  | 'simulated_queued'
  | 'simulated_processed'
  | 'simulated_delivered'
  | 'simulated_read'
  | 'simulated_failed'
  | 'simulated_cancelled';

export type SimulationMessageDirection = 'inbound' | 'outbound';

export type SimulationView =
  | 'inbox'
  | 'schedules'
  | 'templates'
  | 'queue'
  | 'my_whatsapp'
  | 'new_message'
  | 'ready_messages';

export type SimulationCompositionSource = 'manual' | 'quick_reply' | 'template';

export type SimulationQuickReplyStatus = 'active' | 'inactive';

export type SimulationTemplateStatus = 'draft' | 'active' | 'inactive';

export type SimulationTemplateCategory =
  | 'atendimento'
  | 'confirmação'
  | 'reagendamento'
  | 'cancelamento'
  | 'retorno'
  | 'administrativo'
  | 'pós-atendimento';

export type SimulationTemplateVariable =
  | 'contato_nome'
  | 'profissional_nome'
  | 'tenant_nome'
  | 'data_ficticia'
  | 'horario_ficticio';

export interface SimulationTemplatePresentation {
  body: string;
  useContactName: boolean;
  includeDateTime: boolean;
  signProfessional: boolean;
  preserveLegacy: boolean;
  legacyContent?: string;
}

export interface SimulationQuickReply {
  id: string;
  tenantId: SimulationTenantId;
  title: string;
  content: string;
  category: SimulationTemplateCategory;
  status: SimulationQuickReplyStatus;
  displayOrder: number;
}

export interface SimulationTemplate {
  id: string;
  tenantId: SimulationTenantId;
  name: string;
  description: string;
  category: SimulationTemplateCategory;
  version: number;
  content: string;
  allowedVariables: SimulationTemplateVariable[];
  status: SimulationTemplateStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sourceTemplateId?: string;
  usedInSimulation: boolean;
}

export interface SimulationTemplateDraft {
  name: string;
  description: string;
  category: SimulationTemplateCategory;
  content: string;
  allowedVariables: SimulationTemplateVariable[];
  presentation?: SimulationTemplatePresentation;
}

export interface SimulationTemplateFilters {
  search: string;
  category: SimulationTemplateCategory | '';
  status: SimulationTemplateStatus | '';
}

export interface SimulationComposerState {
  mode: SimulationCompositionSource;
  draft: string;
  quickReplyId: string;
  templateId: string;
}

export interface SimulationMessageMetadata {
  source: SimulationCompositionSource;
  quickReplyId?: string;
  templateId?: string;
  templateVersion?: number;
}

export interface SimulationPreview {
  id: string;
  tenantId: SimulationTenantId;
  conversationId: string;
  contactName: string;
  professionalName: string;
  tenantName: string;
  source: SimulationCompositionSource;
  sourceLabel: string;
  templateId?: string;
  templateName?: string;
  templateVersion?: number;
  quickReplyId?: string;
  content: string;
}

export type SimulationHistoryKind =
  | 'state_changed'
  | 'assignment_changed'
  | 'priority_changed'
  | 'tag_changed'
  | 'note_added'
  | 'message_registered';

export interface SimulationTenant {
  id: SimulationTenantId;
  label: string;
  description: string;
}

export interface SimulationProfile {
  id: SimulationProfileId;
  label: string;
  description: string;
}

export interface SimulationProfessional {
  id: string;
  tenantId: SimulationTenantId;
  displayName: string;
  role: string;
}

export interface SimulationTag {
  id: string;
  tenantId: SimulationTenantId;
  label: string;
  tone: 'blue' | 'amber' | 'green' | 'violet' | 'slate';
}

export interface SimulationContact {
  id: string;
  displayName: string;
  reference: string;
  tenantId: SimulationTenantId;
  relationship: string;
  contactPreference: string;
  consentStatus: string;
  optOut: boolean;
}

export interface SimulationMessage {
  id: string;
  tenantId: SimulationTenantId;
  conversationId: string;
  operationKey: string;
  direction: SimulationMessageDirection;
  body: string;
  status: SimulationMessageStatus;
  time: string;
  source?: SimulationCompositionSource;
  quickReplyId?: string;
  templateId?: string;
  templateVersion?: number;
}

export interface SimulationNote {
  id: string;
  tenantId: SimulationTenantId;
  conversationId: string;
  author: string;
  content: string;
  time: string;
}

export interface SimulationHistoryEntry {
  id: string;
  tenantId: SimulationTenantId;
  conversationId: string;
  kind: SimulationHistoryKind;
  label: string;
  actor: string;
  time: string;
}

export interface SimulationConversation {
  id: string;
  tenantId: SimulationTenantId;
  contact: SimulationContact;
  title: string;
  preview: string;
  unreadCount: number;
  messages: SimulationMessage[];
  notes: SimulationNote[];
  history: SimulationHistoryEntry[];
  assignedProfessionalId: string | null;
  priority: SimulationPriority;
  tagIds: string[];
  state: SimulationConversationState;
  scheduled: boolean;
  lastActivity: string;
  lastActivityOrder: number;
}

export interface SimulationTenantData {
  tenant: SimulationTenant;
  professionals: SimulationProfessional[];
  tags: SimulationTag[];
  conversations: SimulationConversation[];
  quickReplies: SimulationQuickReply[];
  templates: SimulationTemplate[];
}

export interface SimulationFilters {
  category: SimulationCategory;
  search: string;
  status: SimulationConversationState | '';
  professionalId: string;
  tagId: string;
}

export interface SimulationState {
  tenants: Record<SimulationTenantId, SimulationTenantData>;
  activeTenantId: SimulationTenantId;
  selectedConversationId: string;
  profileId: SimulationProfileId;
  filters: SimulationFilters;
  notice: string;
  activeView: SimulationView;
  templateFilters: SimulationTemplateFilters;
  selectedTemplateId: string;
  templateDraft: SimulationTemplateDraft | null;
  templateEditingId: string;
  composer: SimulationComposerState;
  preview: SimulationPreview | null;
  clock: SimulationClockState;
  schedules: SimulationSchedule[];
  queueJobs: SimulationQueueJob[];
  selectedScheduleId: string;
  selectedQueueJobId: string;
  scheduleFilters: SimulationScheduleFilters;
  queueFilters: SimulationQueueFilters;
  scheduleDraft: SimulationScheduleDraft | null;
  scheduleEditingId: string;
  schedulePreview: SimulationSchedulePreview | null;
}
