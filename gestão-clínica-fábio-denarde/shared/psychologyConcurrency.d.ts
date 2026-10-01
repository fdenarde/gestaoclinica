type Data = Record<string, any>;
export interface PsychologyChange {
  version: number;
  operation: 'create' | 'update' | 'delete';
  id: string;
  data?: Data;
  changes?: Array<{ path: string[]; before: { present: boolean; value?: unknown }; after: { present: boolean; value?: unknown }; parents: Array<{ present: boolean; map: boolean }> }>;
  fingerprint?: string;
}
export const PSYCHOLOGY_CONFLICT_MESSAGE: string;
export function psychologyPersistenceError(code: string, statusCode?: number): Error & { code: string; statusCode: number; persistenceStatus: string };
export function psychologyStableJson(value: unknown): string;
export function capturePsychologyBaseline<T extends object>(record: T, wire: object, ui?: object): T;
export function copyPsychologyBaseline<T extends object>(record: T, source: object | null | undefined): T;
export function pinPsychologyEdit<T extends object>(record: T, source: object | null | undefined, extraFields?: string[]): T;
export function psychologyBaseline(record: object | null | undefined): { wire: Data; ui: Data; fingerprint?: string; fields?: string[] } | undefined;
export function psychologyField(record: unknown, path: string[]): { present: boolean; value?: unknown };
export function buildPsychologyChange(aggregate: string, id: string, intended: object, baseline?: object, partial?: boolean): PsychologyChange;
export function buildPsychologyDelete(id: string, baseline?: object): PsychologyChange;
export function validatePsychologyChange(change: unknown): PsychologyChange;
export function assertPsychologyBaseline(current: object, changes: NonNullable<PsychologyChange['changes']>): void;
export function applyPsychologyChanges<T extends object>(record: T, changes: NonNullable<PsychologyChange['changes']>): T;
