import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_WHATSAPP_SUPPRESSIONS_PATH = path.resolve(
  'config',
  'whatsapp-reminder-suppressions.json'
);

export function loadWhatsappReminderSuppressions(
  filePath = DEFAULT_WHATSAPP_SUPPRESSIONS_PATH
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo obrigatório de supressões não encontrado: ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (parsed?.version !== 1 || !Array.isArray(parsed.suppressions)) {
    throw new Error(`Formato inválido no arquivo de supressões: ${filePath}`);
  }

  for (const suppression of parsed.suppressions) {
    if (
      !suppression?.id ||
      !suppression.patientId ||
      !suppression.runDate ||
      !suppression.scheduledTime ||
      !suppression.reminderType ||
      !suppression.sessionDate ||
      !suppression.sessionTime ||
      !suppression.reason
    ) {
      throw new Error(`Registro de supressão incompleto no arquivo: ${filePath}`);
    }
  }

  return parsed.suppressions;
}
