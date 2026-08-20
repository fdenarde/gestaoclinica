import type { MessageTemplateDraft, MetaTemplateStatus, MetaTemplateSummary } from './messagingDomain';

export interface MessageTemplateProviderCapabilities {
  canRead: boolean;
  canWrite: boolean;
  metaWriteEnabled: false;
}

export interface MessageTemplateProvider {
  capabilities(): MessageTemplateProviderCapabilities;
  listTemplates(): Promise<readonly MessageTemplateDraft[]>;
  listMetaTemplates(): Promise<readonly MetaTemplateSummary[]>;
  getTemplateStatus(templateId: string): Promise<MetaTemplateStatus>;
  createTemplate(template: MessageTemplateDraft): Promise<MessageTemplateDraft>;
  editTemplate(template: MessageTemplateDraft): Promise<MessageTemplateDraft>;
  deleteTemplate(template: MessageTemplateDraft): Promise<void>;
  syncTemplates(): Promise<readonly MessageTemplateDraft[]>;
  connectionStatus(): Promise<'NOT_CONNECTED'>;
}

/**
 * Local boundary for the future Meta adapter. It deliberately has no network
 * client: the browser never talks to Graph API and no credentials are stored.
 */
export function createNoopMessageTemplateProvider(): MessageTemplateProvider {
  const writeDisabled = (): never => { throw new Error('META_WRITE_DISABLED'); };
  return {
    capabilities: () => ({ canRead: false, canWrite: false, metaWriteEnabled: false }),
    listTemplates: async () => [],
    listMetaTemplates: async () => [],
    getTemplateStatus: async () => 'UNKNOWN',
    createTemplate: async () => writeDisabled(),
    editTemplate: async () => writeDisabled(),
    deleteTemplate: async () => writeDisabled(),
    syncTemplates: async () => [],
    connectionStatus: async () => 'NOT_CONNECTED',
  };
}
