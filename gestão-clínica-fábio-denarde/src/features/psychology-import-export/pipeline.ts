import type { PsychologyStore } from '../psychology-pilot/psychologyDomain';
import { deduplicatePsychologyBundle } from './deduplication';
import { previewImport } from './normalize';
import type { DeduplicationResult, DryRunResult, ImportAnalysis, PsychologyImportBundle } from './types';

export function deduplicateAndPreview(bundle: PsychologyImportBundle, store: PsychologyStore): { result: DeduplicationResult; preview: ReturnType<typeof previewImport> } {
  const result = deduplicatePsychologyBundle(bundle, store);
  return { result, preview: previewImport(result.bundle, store) };
}

export function runPsychologyDryRun(bundle: PsychologyImportBundle, store: PsychologyStore): DryRunResult {
  const { result, preview } = deduplicateAndPreview(bundle, store);
  const strongLinks = result.signals.filter(signal => !signal.requiresReview && signal.existingPatientId).length;
  const totalRecords = Object.values(preview.counts).reduce((sum, count) => sum + count, 0);
  const ignores = bundle.conflicts.filter(conflict => conflict.type === 'unsupported_record' || conflict.type === 'unsupported_field').length;
  const details = [
    `${preview.counts.patients} paciente(s) analisado(s).`,
    `${preview.counts.appointments} consulta(s) analisada(s).`,
    `${strongLinks} vínculo(s) forte(s) por identificador externo; nenhum vínculo por nome foi confirmado automaticamente.`,
    `${preview.unlinkedAttachments} anexo(s) sem vínculo.`,
    `${totalRecords} registro(s) percorreram Parse → Normalize → Validate → Deduplicate → Preview.`,
  ];
  return { creates: Math.max(0, totalRecords - strongLinks - ignores), links: strongLinks, ignores, conflicts: result.conflicts.length, warnings: result.warnings.length, unlinked: preview.unlinkedAttachments, details, persisted: false };
}

export function analysisToDryRun(analysis: ImportAnalysis, store: PsychologyStore): DryRunResult {
  return runPsychologyDryRun(analysis.bundle, store);
}
