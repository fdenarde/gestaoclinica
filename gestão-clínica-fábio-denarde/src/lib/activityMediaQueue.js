import { MAX_ACTIVITY_MEDIA_ITEMS } from '../../shared/activityMediaLimits.js';

export const MAX_ACTIVITY_VISUAL_PREVIEWS = 8;
export const MAX_ACTIVITY_FILES_PER_SELECTION = MAX_ACTIVITY_MEDIA_ITEMS;
export const MAX_ACTIVITY_TOTAL_MEDIA = MAX_ACTIVITY_MEDIA_ITEMS;

export function getActivityRemainingSlots(confirmedCount, queuedCount = 0) {
  return Math.max(0, MAX_ACTIVITY_TOTAL_MEDIA - confirmedCount - queuedCount);
}

export function validateActivityBatchSelection({
  incomingCount,
  confirmedCount,
  queuedItems,
  busy = false,
}) {
  const currentItems = Array.isArray(queuedItems) ? queuedItems : [];
  const remainingSlots = getActivityRemainingSlots(confirmedCount, currentItems.length);

  if (busy) {
    return { allowed: false, code: 'batch-busy', remainingSlots };
  }
  if (currentItems.length > 0) {
    return { allowed: false, code: 'batch-unresolved', remainingSlots };
  }
  if (incomingCount > MAX_ACTIVITY_FILES_PER_SELECTION) {
    return { allowed: false, code: 'selection-too-large', remainingSlots };
  }
  if (incomingCount > remainingSlots) {
    return { allowed: false, code: 'activity-limit-exceeded', remainingSlots };
  }
  if (incomingCount <= 0) {
    return { allowed: false, code: 'empty-selection', remainingSlots };
  }
  return { allowed: true, code: 'allowed', remainingSlots };
}

export function getActivitySelectionErrorMessage(result) {
  if (result.code === 'selection-too-large') {
    return `Selecione no máximo ${MAX_ACTIVITY_FILES_PER_SELECTION} arquivos para esta atividade.`;
  }
  if (result.code === 'activity-limit-exceeded') {
    return result.remainingSlots === 0
      ? `Limite de ${MAX_ACTIVITY_TOTAL_MEDIA} mídias atingido.`
      : `Esta atividade possui apenas ${result.remainingSlots} ${result.remainingSlots === 1 ? 'vaga restante' : 'vagas restantes'}. Selecione no máximo essa quantidade.`;
  }
  if (result.code === 'batch-busy') {
    return 'Aguarde a conclusão do lote atual antes de adicionar outro.';
  }
  if (result.code === 'batch-unresolved') {
    return 'Resolva, reenvie ou remova todos os itens do lote atual antes de adicionar o próximo.';
  }
  return 'Nenhuma mídia foi selecionada.';
}

export function getAcceptedActivityBatchFiles(files, validationResult) {
  return validationResult.allowed ? Array.from(files || []) : [];
}

export function getActivityBatchOverview(confirmedCount, items) {
  const queue = getActivityQueueCounts(items);
  return {
    confirmed: confirmedCount,
    currentBatch: queue.total,
    remaining: getActivityRemainingSlots(confirmedCount, queue.total),
    ...queue,
  };
}

export function canAddNextActivityBatch({ confirmedCount, queuedItems, busy = false }) {
  return !busy
    && confirmedCount < MAX_ACTIVITY_TOTAL_MEDIA
    && Array.isArray(queuedItems)
    && queuedItems.length === 0;
}

export function recordConfirmedActivityMedia(state, savedCount) {
  return {
    ...state,
    confirmedCount: Math.min(MAX_ACTIVITY_TOTAL_MEDIA, state.confirmedCount + savedCount),
  };
}

export function preserveActivityBatchMetadata(metadata) {
  return { ...metadata };
}

export function getActivityCloseImpact(confirmedCount, queuedItems) {
  return {
    confirmedPreserved: confirmedCount,
    localItemsDiscarded: Array.isArray(queuedItems) ? queuedItems.length : 0,
  };
}

export function createActivityMediaRetention(
  file,
  showPreview,
  createObjectUrl = URL.createObjectURL,
  revokeObjectUrl = URL.revokeObjectURL,
) {
  let previewUrl = '';
  try {
    previewUrl = showPreview ? createObjectUrl(file) : '';
    return {
      previewUrl,
      retentionUrl: createObjectUrl(file),
    };
  } catch (error) {
    if (previewUrl) revokeObjectUrl(previewUrl);
    throw error;
  }
}

export function releaseActivityMediaRetention(item, revokeObjectUrl = URL.revokeObjectURL) {
  const urls = new Set([item?.previewUrl, item?.retentionUrl].filter(Boolean));
  for (const url of urls) revokeObjectUrl(url);
}

export function replaceActivityMediaRetention(item, file, createObjectUrl = URL.createObjectURL, revokeObjectUrl = URL.revokeObjectURL) {
  const showPreview = Boolean(item.previewUrl);
  const replacement = createActivityMediaRetention(file, showPreview, createObjectUrl, revokeObjectUrl);
  releaseActivityMediaRetention(item, revokeObjectUrl);
  return replacement;
}

export function getActivityQueueCounts(items) {
  const needsReselection = items.filter(item => item.needsReselection).length;
  const retryable = items.filter(item => item.status === 'failed' && !item.needsReselection).length;
  const pending = items.filter(item => ['queued', 'preparing'].includes(item.status) && !item.needsReselection).length;
  const acquiring = items.filter(item => item.status === 'acquiring').length;
  const duplicates = items.filter(item => item.status === 'duplicate').length;
  const verificationWarnings = items.filter(item => item.status === 'verification').length;
  const uploading = items.filter(item => item.status === 'uploading').length;
  return {
    total: items.length,
    needsReselection,
    retryable,
    pending,
    acquiring,
    duplicates,
    verificationWarnings,
    uploading,
    available: pending + retryable,
  };
}

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function isSameSessionDuplicateError(error) {
  const code = String(error?.code || '');
  return [
    'activity-records/duplicate',
    'activity-records/duplicate-same-session',
    'activity-records/duplicate_same_session',
    'activity-records/already-confirmed',
    'activity-records/already_confirmed',
  ].includes(code);
}

export function getActivityQueueStatusMessage(counts) {
  const parts = [];
  if (counts.acquiring > 0) parts.push(formatCount(counts.acquiring, 'mídia em preparação', 'mídias em preparação'));
  if (counts.pending > 0) parts.push(formatCount(counts.pending, 'mídia aguardando envio', 'mídias aguardando envio'));
  if (counts.uploading > 0) parts.push(formatCount(counts.uploading, 'mídia em envio', 'mídias em envio'));
  if (counts.duplicates > 0) parts.push(formatCount(counts.duplicates, 'mídia precisa de decisão por repetição', 'mídias precisam de decisão por repetição'));
  if (counts.verificationWarnings > 0) parts.push(formatCount(counts.verificationWarnings, 'mídia precisa de conferência na galeria', 'mídias precisam de conferência na galeria'));
  if (counts.retryable > 0) parts.push(formatCount(counts.retryable, 'mídia disponível para nova tentativa', 'mídias disponíveis para nova tentativa'));
  if (counts.needsReselection > 0) parts.push(formatCount(counts.needsReselection, 'mídia precisa ser selecionada novamente', 'mídias precisam ser selecionadas novamente'));
  return parts.length > 0 ? `${parts.join(' • ')}.` : 'Nenhuma mídia adicionada ainda.';
}

export function getActivityFailurePresentation({ needsReselection, errorMessage }) {
  if (needsReselection) {
    return {
      title: 'Selecione este arquivo novamente',
      message: errorMessage || 'Este arquivo não está mais disponível no celular. Selecione-o novamente para continuar.',
      tone: 'attention',
    };
  }
  const sanitizedMessage = sanitizeActivityMediaErrorMessage(errorMessage);
  const safetyMessage = /permanece disponível|continua disponível/i.test(sanitizedMessage)
    ? sanitizedMessage
    : `${sanitizedMessage || 'Não foi possível concluir o envio.'} O arquivo permanece disponível para uma nova tentativa.`;
  return {
    title: 'O envio não foi concluído',
    message: safetyMessage,
    tone: 'error',
  };
}

export function getActivityUploadSummaryTone(summary) {
  if (summary.failed > 0) return 'error';
  if (summary.pending > 0 || (summary.duplicates || 0) > 0) return 'warning';
  return 'success';
}

export function getActivityUploadSummaryTitle(summary) {
  const tone = getActivityUploadSummaryTone(summary);
  if (tone === 'error') return 'Falha no envio';
  if (summary.pending > 0) return 'Envio interrompido';
  if ((summary.duplicates || 0) > 0) return 'Mídias repetidas';
  return 'Envio concluído';
}

export function shouldShowActivitySaveButton(items) {
  return getActivityQueueCounts(items).available > 0;
}

export function createPreparedPhotoRetry(preparedMedia) {
  if (preparedMedia?.mediaType !== 'photo') return undefined;
  return {
    file: preparedMedia.file,
    width: preparedMedia.width,
    height: preparedMedia.height,
    sha256: preparedMedia.sha256,
    lastModified: preparedMedia.lastModified,
  };
}

export function formatActivityUploadSummary(summary) {
  const duplicates = Number(summary.duplicates || 0);
  if (summary.failed > 0) {
    const duplicateNote = duplicates > 0
      ? ` ${formatCount(duplicates, 'repetida foi ignorada', 'repetidas foram ignoradas')}.`
      : '';
    return `${formatCount(summary.saved, 'mídia salva', 'mídias salvas')}. ${formatCount(summary.failed, 'falhou', 'falharam')}. Tente novamente apenas as mídias com falha.${duplicateNote}`;
  }
  if (summary.pending > 0) {
    return `${formatCount(summary.saved, 'mídia salva', 'mídias salvas')}. ${formatCount(summary.pending, 'continua aguardando envio', 'continuam aguardando envio')}.`;
  }
  if (duplicates > 0 && summary.saved === 0) {
    return `${formatCount(duplicates, 'mídia repetida', 'mídias repetidas')}. Nenhuma nova mídia foi enviada.`;
  }
  if (duplicates > 0) {
    return `${formatCount(summary.saved, 'mídia nova salva', 'mídias novas salvas')}. ${formatCount(duplicates, 'repetida não foi enviada', 'repetidas não foram enviadas')}.`;
  }
  if (summary.totalConfirmed >= MAX_ACTIVITY_TOTAL_MEDIA) {
    return `${formatCount(summary.saved, 'mídia salva', 'mídias salvas')}. Limite de ${MAX_ACTIVITY_TOTAL_MEDIA} mídias atingido.`;
  }
  return `${formatCount(summary.saved, 'mídia salva', 'mídias salvas')}. Você pode adicionar mais mídias ou finalizar a atividade.`;
}

export function matchActivityMediaReplacements(items, files) {
  const remainingItems = items.filter(item => item.needsReselection);
  const matches = [];
  const unmatchedFiles = [];

  for (const file of files) {
    const fileName = String(file.name || '');
    const fileType = String(file.type || '');
    const isPhoto = fileType.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(fileName);
    const isVideo = fileType.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(fileName);
    const matchIndex = remainingItems.findIndex(item =>
      item.originalName === file.name
      && item.fileSize === file.size
      && (item.mediaType === 'photo' ? isPhoto : isVideo),
    );
    if (matchIndex < 0) {
      unmatchedFiles.push(file);
      continue;
    }
    matches.push({ item: remainingItems[matchIndex], file });
    remainingItems.splice(matchIndex, 1);
  }

  return { matches, unmatchedFiles, unmatchedItems: remainingItems };
}

export async function processAfterNonBlockingProbe({ probe, process, onProbeResult }) {
  let probeReadable = true;
  try {
    await probe();
  } catch (error) {
    probeReadable = false;
    onProbeResult?.({ readable: false, error });
  }
  if (probeReadable) onProbeResult?.({ readable: true });
  return process();
}

export function isActivityMediaFileReadError(error) {
  const code = String(error?.code || '');
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  return [
    'activity-records/local-file-unavailable',
    'activity-records/read-failed',
    'activity-records/video-chunk-read-failed',
  ].includes(code)
    || /NotReadableError/i.test(name)
    || /requested file could not be read|permission problems?.*file|file or directory was acquired|could not be read/i.test(message);
}

export function classifyActivityMediaError(error) {
  const code = error?.code || '';
  if (isActivityMediaFileReadError(error)) return 'real-read-failed';
  if (code === 'activity-records/compression-failed' || code === 'activity-records/canvas-unavailable' || code === 'activity-records/output-too-large' || code === 'activity-records/black-preview') return 'compression-failed';
  if (code === 'activity-records/video-chunk-read-failed') return 'chunk-read-failed';
  if (code === 'activity-records/chunk-timeout' || code === 'activity-records/upload-timeout') return 'timeout';
  if (code === 'activity-records/network-error') return 'network-failed';
  if (code === 'activity-records/response-lost') return 'response-lost';
  if (code === 'activity-records/upload-chunk-failed' || code === 'activity-records/video-chunk-failed') return 'drive-failed';
  if (code === 'activity-records/upload-failed') return 'drive-failed';
  if (code === 'activity-records/request-failed' || code === 'activity-records/invalid-response') return 'api-failed';
  if (code === 'activity-records/upload-cancelled') return 'cancelled';
  return 'other';
}

export function sanitizeActivityMediaErrorMessage(message) {
  const value = String(message || '').trim();
  if (!value) return '';
  if (/requested file could not be read|permission problems?.*file|file or directory was acquired|NotReadableError|could not be read/i.test(value)) {
    return 'O arquivo original não pôde ser lido pelo celular. Selecione novamente somente este arquivo.';
  }
  if (/firestore|undefined|ignoreUndefinedProperties|stack trace|valid Firestore document/i.test(value)) {
    return 'Não foi possível registrar esta mídia. O arquivo permanece disponível para nova tentativa.';
  }
  if (/^[\x00-\x7F]+$/.test(value) && /\b(error|failed|failure|permission|request|file|directory|read|write|network|timeout)\b/i.test(value)) {
    return 'Não foi possível concluir esta etapa. Confira o arquivo indicado e tente novamente.';
  }
  return value;
}
