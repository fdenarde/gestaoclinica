import { normalizeMetaTemplateStatus, type MetaTemplateStatus } from './messagingDomain';

export interface MetaTemplateStatusUpdate {
  event: 'message_template_status_update';
  metaTemplateId: string;
  status: MetaTemplateStatus;
  receivedAt: string;
}

/** Contract only: no webhook route or Meta subscription is activated here. */
export function normalizeMetaTemplateStatusUpdate(input: unknown, receivedAt = new Date().toISOString()): MetaTemplateStatusUpdate | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as { event?: unknown; id?: unknown; template_id?: unknown; status?: unknown };
  const metaTemplateId = String(source.id || source.template_id || '').trim();
  if (!metaTemplateId) return null;
  return {
    event: 'message_template_status_update',
    metaTemplateId,
    status: normalizeMetaTemplateStatus(source.status),
    receivedAt,
  };
}
