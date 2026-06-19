import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  EyeOff,
  Images,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { Patient, Session } from '../../types';
import {
  ACTIVITY_RECORD_CATEGORIES,
  type ActivityRecordCategory,
} from '../../types/activityRecords';
import type {
  GooglePhotosAlbum,
  GooglePhotosAlbumCapabilities,
  GooglePhotosAlbumInput,
} from '../../types/googlePhotosAlbums';
import {
  listGooglePhotosAlbumPatientOptions,
  listGooglePhotosAlbumSessionOptions,
  listGooglePhotosAlbums,
  saveGooglePhotosAlbumPackage,
} from '../../lib/googlePhotosAlbumsApi';
import { buildActivityMediaPackageModel } from '../../lib/activityMediaPackages';
import { safeFormatDate } from '../../lib/utils';
import PatientPhoto from '../Common/PatientPhoto';
import {
  buildGooglePhotosAlbumGroupKey,
  buildGooglePhotosAlbumPackageKey,
  buildGooglePhotosVirtualAlbumCards,
  mergeGooglePhotosAlbumCards,
  normalizeGooglePhotosAlbumUrl,
} from '../../../shared/googlePhotosAlbums.js';

interface Props {
  patients: Patient[];
  sessions: Session[];
  currentUserName: string;
  initialPatientId?: string | null;
}

const EMPTY_PERMISSIONS: GooglePhotosAlbumCapabilities = {
  canView: true,
  canCreate: false,
  canEdit: false,
  canHide: false,
  canReactivate: false,
  canRemove: false,
};

const buildAlbumGroupKey = buildGooglePhotosAlbumGroupKey as (options: {
  patientId: string;
  activityDate: string;
  sessionIds: string[];
}) => string;

const buildPackageKey = buildGooglePhotosAlbumPackageKey as (options: {
  patientId: string;
  packageNumber: number;
}) => string;

const normalizeAlbumUrl = normalizeGooglePhotosAlbumUrl as (value: string) => string | null;
const AUTOSAVE_DELAY_MS = 2000;
type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'invalid' | 'error' | 'switching';

function todayIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function normalizeTimeForSort(time = ''): string {
  const [hour = '00', minute = '00'] = String(time || '').split(':');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function sessionSortKey(session: Session): string {
  return `${session.date || ''}T${normalizeTimeForSort(session.time)}|${session.id || ''}`;
}

function cardStatusLabel(card: GooglePhotosAlbum): string {
  return card.status === 'hidden' ? 'Oculto' : 'Ativo';
}

function formatSessionNumbers(numbers: number[]): string {
  const values = [...new Set((numbers || []).filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  if (values.length === 0) return '';
  if (values.length === 1) return `Sessão ${values[0]}`;
  return `Sessões ${values.slice(0, -1).join(', ')} e ${values.at(-1)}`;
}

function toPackageInput(card: GooglePhotosAlbum): GooglePhotosAlbumInput {
  return {
    id: card.id,
    packageKey: card.packageKey,
    packageNumber: card.packageNumber,
    patientId: card.patientId,
    sessionIds: card.sessionIds,
    sessionGroupKey: card.sessionGroupKey,
    activityDate: card.activityDate,
    title: card.title,
    category: card.category,
    url: normalizeAlbumUrl(card.url) || '',
    visibleToGuardian: card.visibleToGuardian,
    observation: card.observation,
    publishedAt: card.publishedAt || todayIsoDate(),
    status: card.status,
  };
}

export default function ProfessionalGooglePhotosGallery({
  patients,
  sessions,
  currentUserName,
  initialPatientId = null,
}: Props) {
  const [patientOptions, setPatientOptions] = useState<Array<{ id: string; name: string }>>(() => patients.map(patient => ({ id: patient.id, name: patient.fullName || patient.name })));
  const [remoteSessions, setRemoteSessions] = useState<Session[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState(() => String(initialPatientId || '').trim());
  const [patientSearch, setPatientSearch] = useState('');
  const [persistedCards, setPersistedCards] = useState<GooglePhotosAlbum[]>([]);
  const [draftCards, setDraftCards] = useState<Record<string, GooglePhotosAlbum>>({});
  const [removedCardIds, setRemovedCardIds] = useState<string[]>([]);
  const [editingCardIds, setEditingCardIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<GooglePhotosAlbumCapabilities>(EMPTY_PERMISSIONS);
  const [ownerUserId, setOwnerUserId] = useState('');
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const autosaveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const lastConfirmedSignatureRef = useRef('[]');
  const allCardsRef = useRef<GooglePhotosAlbum[]>([]);
  const selectedPatientIdRef = useRef('');
  const currentPackageNumberRef = useRef(0);
  const permissionsRef = useRef(EMPTY_PERMISSIONS);
  const performAutosaveRef = useRef<(immediate?: boolean) => Promise<boolean>>(async () => false);

  useEffect(() => {
    if (patients.length > 0) {
      setPatientOptions(patients.map(patient => ({ id: patient.id, name: patient.fullName || patient.name })));
      return;
    }
    let active = true;
    void listGooglePhotosAlbumPatientOptions()
      .then(options => {
        if (active) setPatientOptions(options);
      })
      .catch(caughtError => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar os atendentes autorizados.');
      });
    return () => { active = false; };
  }, [patients]);

  const selectedPatient = useMemo(
    () => patients.find(patient => patient.id === selectedPatientId) || null,
    [patients, selectedPatientId],
  );
  const selectedPatientName = selectedPatient?.fullName
    || selectedPatient?.name
    || patientOptions.find(patient => patient.id === selectedPatientId)?.name
    || '';

  const patientCards = useMemo(() => {
    const today = todayIsoDate();
    const search = patientSearch.trim().toLowerCase();
    return patientOptions
      .map(option => {
        const patient = patients.find(item => item.id === option.id) || null;
        const patientSessions = sessions.filter(session => session.patientId === option.id);
        const model = buildActivityMediaPackageModel({ patientId: option.id, sessions: patientSessions });
        const currentSessions = model.currentSessions || [];
        const latestSession = currentSessions[0] || patientSessions
          .slice()
          .filter(session => !session.isBlocked)
          .sort((left, right) => sessionSortKey(right).localeCompare(sessionSortKey(left)))[0] || null;
        const latestSessionNumber = Number((latestSession as Session & { activitySessionNumber?: number } | null)?.activitySessionNumber || 0);
        return {
          id: option.id,
          name: patient?.fullName || patient?.name || option.name,
          photoUrl: patient?.photoUrl || '',
          photoDriveFileId: patient?.photoDriveFileId || '',
          packageNumber: model.currentPackageNumber || 1,
          progressLabel: latestSessionNumber > 0 ? `Sessão ${latestSessionNumber} de 10` : '',
          latestSessionDate: latestSession?.date || '',
          hasSessionToday: patientSessions.some(session => session.date === today && !session.isBlocked),
        };
      })
      .filter(card => !search || card.name.toLowerCase().includes(search))
      .sort((left, right) => (
        left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' })
      ));
  }, [patientOptions, patientSearch, patients, sessions]);

  const sessionSource = useMemo(() => {
    const local = sessions.filter(session => session.patientId === selectedPatientId);
    return local.length > 0 ? local : remoteSessions.filter(session => session.patientId === selectedPatientId);
  }, [remoteSessions, selectedPatientId, sessions]);

  const packageModel = useMemo(() => buildActivityMediaPackageModel({
    patientId: selectedPatientId,
    sessions: sessionSource,
  }), [selectedPatientId, sessionSource]);

  const currentPackageNumber = packageModel.currentPackageNumber || 1;
  const currentPackage = useMemo(() => (
    packageModel.packages.find(pkg => pkg.number === currentPackageNumber) || null
  ), [currentPackageNumber, packageModel.packages]);

  const packageSessions = useMemo(
    () => (currentPackage?.sessions || []).slice().sort((left, right) => sessionSortKey(left).localeCompare(sessionSortKey(right))),
    [currentPackage?.sessions],
  );

  const virtualCards = useMemo(() => (
    buildGooglePhotosVirtualAlbumCards(sessionSource, {
      patientId: selectedPatientId,
      patientName: selectedPatientName,
      packageNumber: currentPackageNumber,
    }) as GooglePhotosAlbum[]
  ), [currentPackageNumber, selectedPatientId, selectedPatientName, sessionSource]);

  const allCards = useMemo(() => (
    mergeGooglePhotosAlbumCards({
      virtualCards,
      persistedCards,
      draftCards: Object.values(draftCards),
      removedCardIds,
    }) as GooglePhotosAlbum[]
  ), [draftCards, persistedCards, removedCardIds, virtualCards]);

  const hasLocalChanges = Object.keys(draftCards).length > 0 || removedCardIds.length > 0;
  const currentPackageKey = useMemo(() => buildPackageKey({
    patientId: selectedPatientId,
    packageNumber: currentPackageNumber,
  }), [currentPackageNumber, selectedPatientId]);
  const draftStorageKey = ownerUserId && selectedPatientId && currentPackageKey
    ? `googlePhotosAlbumDraft:${ownerUserId}:${selectedPatientId}:${currentPackageKey}:manage`
    : '';
  const invalidCardIds = useMemo(() => allCards
    .filter(card => card.url.trim() && !normalizeAlbumUrl(card.url))
    .map(card => card.id), [allCards]);
  const invalidCardIdSet = useMemo(() => new Set(invalidCardIds), [invalidCardIds]);
  const hasInvalidLinks = invalidCardIds.length > 0;
  const savableCardsSignature = useMemo(() => {
    const inputs = allCards
      .filter(card => Boolean(normalizeAlbumUrl(card.url)))
      .map(card => toPackageInput({ ...card, url: normalizeAlbumUrl(card.url) || '' }))
      .sort((left, right) => String(left.id || left.sessionGroupKey).localeCompare(String(right.id || right.sessionGroupKey)));
    return JSON.stringify(inputs);
  }, [allCards]);

  useEffect(() => {
    allCardsRef.current = allCards;
  }, [allCards]);

  useEffect(() => {
    selectedPatientIdRef.current = selectedPatientId;
    currentPackageNumberRef.current = currentPackageNumber;
    permissionsRef.current = permissions;
  }, [currentPackageNumber, permissions, selectedPatientId]);

  const loadSessionsIfNeeded = useCallback(async () => {
    if (!selectedPatientId) return;
    const hasLocal = sessions.some(session => session.patientId === selectedPatientId);
    const hasRemote = remoteSessions.some(session => session.patientId === selectedPatientId);
    if (hasLocal || hasRemote || loadingSessions) return;
    setLoadingSessions(true);
    try {
      const loaded = await listGooglePhotosAlbumSessionOptions(selectedPatientId) as unknown as Session[];
      setRemoteSessions(current => [
        ...current.filter(session => session.patientId !== selectedPatientId),
        ...loaded,
      ]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar as sessões do atendente.');
    } finally {
      setLoadingSessions(false);
    }
  }, [loadingSessions, remoteSessions, selectedPatientId, sessions]);

  useEffect(() => {
    void loadSessionsIfNeeded();
  }, [loadSessionsIfNeeded]);

  const loadCards = useCallback(async (force = false) => {
    if (!selectedPatientId || !currentPackageNumber) {
      setPersistedCards([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await listGooglePhotosAlbums({
        patientId: selectedPatientId,
        packageNumber: currentPackageNumber,
        scope: 'manage',
        force,
      });
      setPersistedCards(result.albums);
      setPermissions(result.permissions);
      setOwnerUserId(result.ownerUserId || '');
      const confirmedSignature = JSON.stringify(result.albums
        .filter(card => Boolean(normalizeAlbumUrl(card.url)))
        .map(card => toPackageInput({ ...card, url: normalizeAlbumUrl(card.url) || '' }))
        .sort((left, right) => String(left.id || left.sessionGroupKey).localeCompare(String(right.id || right.sessionGroupKey))));
      lastConfirmedSignatureRef.current = confirmedSignature;
      const packageKey = result.packageKey || buildPackageKey({ patientId: selectedPatientId, packageNumber: currentPackageNumber });
      const storageKey = result.ownerUserId
        ? `googlePhotosAlbumDraft:${result.ownerUserId}:${selectedPatientId}:${packageKey}:manage`
        : '';
      if (storageKey && typeof window !== 'undefined') {
        try {
          const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null') as {
            draftCards?: Record<string, GooglePhotosAlbum>;
            removedCardIds?: string[];
          } | null;
          setDraftCards(parsed?.draftCards && typeof parsed.draftCards === 'object' ? parsed.draftCards : {});
          setRemovedCardIds(Array.isArray(parsed?.removedCardIds) ? parsed.removedCardIds : []);
        } catch {
          setDraftCards({});
          setRemovedCardIds([]);
        }
      } else {
        setDraftCards({});
        setRemovedCardIds([]);
      }
      setEditingCardIds([]);
      setAutosaveStatus('idle');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível carregar os cards do pacote.');
    } finally {
      setLoading(false);
    }
  }, [currentPackageNumber, selectedPatientId]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const selectPatient = (patientId: string) => {
    setSelectedPatientId(patientId);
    setPersistedCards([]);
    setDraftCards({});
    setRemovedCardIds([]);
    setEditingCardIds([]);
    setOwnerUserId('');
    setAutosaveStatus('idle');
    lastConfirmedSignatureRef.current = '[]';
    setMessage('');
    setError('');
  };

  const openEditor = (card: GooglePhotosAlbum) => {
    setEditingCardIds(current => current.includes(card.id) ? current : [...current, card.id]);
    const authorizeNewLinkByDefault = !card.url.trim() && card.status !== 'hidden';
    setDraftCards(current => current[card.id] ? current : {
      ...current,
      [card.id]: {
        ...card,
        visibleToGuardian: authorizeNewLinkByDefault ? true : card.visibleToGuardian,
        isVirtual: false,
      },
    });
    setMessage('');
  };

  const closeEditor = (cardId: string) => {
    setEditingCardIds(current => current.filter(id => id !== cardId));
  };

  const commitCard = (previousId: string, nextCard: GooglePhotosAlbum) => {
    setDraftCards(current => {
      const copy = { ...current };
      if (previousId !== nextCard.id) delete copy[previousId];
      copy[nextCard.id] = { ...nextCard, isVirtual: false };
      return copy;
    });
    if (previousId !== nextCard.id) {
      setRemovedCardIds(current => current.includes(previousId) ? current : [...current, previousId]);
      setEditingCardIds(current => current.filter(id => id !== previousId).includes(nextCard.id)
        ? current.filter(id => id !== previousId)
        : [...current.filter(id => id !== previousId), nextCard.id]);
    }
    setMessage('');
  };

  const updateCard = (card: GooglePhotosAlbum, patch: Partial<GooglePhotosAlbum>) => {
    const base = draftCards[card.id] || card;
    commitCard(card.id, { ...base, ...patch, isVirtual: false });
  };

  const updateCardSessions = (card: GooglePhotosAlbum, sessionIds: string[]) => {
    const selected = packageSessions
      .filter(session => sessionIds.includes(session.id))
      .sort((left, right) => sessionSortKey(left).localeCompare(sessionSortKey(right)));
    if (selected.length === 0) {
      setError('Mantenha pelo menos uma sessão vinculada ao card.');
      return;
    }
    const firstDate = selected[0].date;
    if (selected.some(session => session.date !== firstDate)) {
      setError('Um card só pode agrupar sessões da mesma data.');
      return;
    }
    const normalizedIds = selected.map(session => session.id).sort();
    const sessionGroupKey = buildAlbumGroupKey({
      patientId: selectedPatientId,
      activityDate: firstDate,
      sessionIds: normalizedIds,
    });
    const sessionNumbers = [...new Set<number>(selected
      .map(session => Number((session as Session & { activitySessionNumber?: number }).activitySessionNumber ?? session.packageNumber))
      .filter((value): value is number => Number.isFinite(value) && value > 0))]
      .sort((a, b) => a - b);
    const base = draftCards[card.id] || card;
    commitCard(card.id, {
      ...base,
      id: sessionGroupKey,
      sessionGroupKey,
      sessionIds: normalizedIds,
      sessionId: normalizedIds[0] || null,
      activityDate: firstDate,
      sessionTime: selected[0]?.time || null,
      sessionNumbers,
      isVirtual: false,
    });
  };

  const clearCardLink = (card: GooglePhotosAlbum) => {
    updateCard(card, {
      url: '',
      visibleToGuardian: false,
      status: 'active',
    });
    openEditor(card);
  };

  const buildSavableInputs = useCallback((sourceCards: GooglePhotosAlbum[]) => sourceCards
    .filter(card => Boolean(normalizeAlbumUrl(card.url)))
    .map(card => toPackageInput({ ...card, url: normalizeAlbumUrl(card.url) || '' }))
    .sort((left, right) => String(left.id || left.sessionGroupKey).localeCompare(String(right.id || right.sessionGroupKey))), []);

  const performAutosave = useCallback(async (immediate = false): Promise<boolean> => {
    if (!selectedPatientIdRef.current || !currentPackageNumberRef.current || !permissionsRef.current.canEdit) return true;
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return false;
    }
    const cardsWithLinks = buildSavableInputs(allCardsRef.current);
    const nextSignature = JSON.stringify(cardsWithLinks);
    if (nextSignature === lastConfirmedSignatureRef.current && !immediate) {
      setAutosaveStatus(hasInvalidLinks ? 'invalid' : 'idle');
      return true;
    }
    if (nextSignature === lastConfirmedSignatureRef.current && immediate) {
      setAutosaveStatus(hasInvalidLinks ? 'invalid' : 'idle');
      return true;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    setAutosaveStatus('saving');
    try {
      const result = await saveGooglePhotosAlbumPackage({
        patientId: selectedPatientIdRef.current,
        packageNumber: currentPackageNumberRef.current,
        cards: cardsWithLinks,
      });
      setPersistedCards(result.albums);
      setPermissions(result.permissions);
      setOwnerUserId(result.ownerUserId || ownerUserId);
      setDraftCards({});
      setRemovedCardIds([]);
      setEditingCardIds([]);
      lastConfirmedSignatureRef.current = JSON.stringify(buildSavableInputs(result.albums));
      if (draftStorageKey && typeof window !== 'undefined') window.sessionStorage.removeItem(draftStorageKey);
      setAutosaveStatus('idle');
      setMessage('Tudo salvo.');
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar os links do pacote.');
      setAutosaveStatus('error');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (queuedSaveRef.current) {
        queuedSaveRef.current = false;
        window.setTimeout(() => { void performAutosaveRef.current(true); }, 0);
      }
    }
  }, [buildSavableInputs, draftStorageKey, hasInvalidLinks, ownerUserId]);

  useEffect(() => {
    performAutosaveRef.current = performAutosave;
  }, [performAutosave]);

  const saveNow = useCallback(async () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    return performAutosave(true);
  }, [performAutosave]);

  useEffect(() => {
    if (!draftStorageKey || typeof window === 'undefined') return;
    if (!hasLocalChanges) return;
    window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ draftCards, removedCardIds }));
  }, [draftCards, draftStorageKey, hasLocalChanges, removedCardIds]);

  useEffect(() => {
    if (!selectedPatientId || loading || !permissions.canEdit || !hasLocalChanges) return undefined;
    if (hasInvalidLinks && savableCardsSignature === lastConfirmedSignatureRef.current) {
      setAutosaveStatus('invalid');
      return undefined;
    }
    if (savableCardsSignature === lastConfirmedSignatureRef.current) {
      setAutosaveStatus(hasInvalidLinks ? 'invalid' : 'idle');
      return undefined;
    }
    setAutosaveStatus(hasInvalidLinks ? 'invalid' : 'pending');
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void performAutosave(false);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [hasInvalidLinks, hasLocalChanges, loading, performAutosave, permissions.canEdit, savableCardsSignature, selectedPatientId]);

  useEffect(() => {
    const shouldWarn = hasLocalChanges || autosaveStatus === 'pending' || autosaveStatus === 'saving' || autosaveStatus === 'error';
    if (!shouldWarn) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autosaveStatus, hasLocalChanges]);

  const returnToPatientSelection = useCallback(async () => {
    if (hasLocalChanges || autosaveStatus === 'pending' || autosaveStatus === 'error') {
      setAutosaveStatus('switching');
      const saved = await saveNow();
      if (!saved) return;
    }
    if (savingRef.current) {
      setAutosaveStatus('switching');
      queuedSaveRef.current = true;
      const saved = await saveNow();
      if (!saved) return;
    }
    setSelectedPatientId('');
    setPersistedCards([]);
    setDraftCards({});
    setRemovedCardIds([]);
    setEditingCardIds([]);
    setOwnerUserId('');
    setAutosaveStatus('idle');
    setMessage('');
    setError('');
  }, [autosaveStatus, hasLocalChanges, saveNow]);

  const cardsWithLinksCount = allCards.filter(card => card.url.trim()).length;
  const autosaveLabel = autosaveStatus === 'saving'
    ? 'Salvando...'
    : autosaveStatus === 'pending'
      ? 'Alterações pendentes'
      : autosaveStatus === 'invalid'
        ? 'Revise os campos destacados'
        : autosaveStatus === 'error'
          ? 'Não foi possível salvar'
          : autosaveStatus === 'switching'
            ? 'Concluindo salvamento...'
            : 'Tudo salvo';
  const autosaveTone = autosaveStatus === 'error' || autosaveStatus === 'invalid'
    ? 'border-status-orange-text/30 bg-status-orange-bg text-status-orange-text'
    : autosaveStatus === 'saving' || autosaveStatus === 'pending' || autosaveStatus === 'switching'
      ? 'border-status-blue-text/20 bg-status-blue-bg text-status-blue-text'
      : 'border-status-green-text/20 bg-status-green-bg text-status-green-text';
  const showSaveNow = permissions.canEdit
    && (autosaveStatus === 'pending' || autosaveStatus === 'error' || (hasLocalChanges && savableCardsSignature !== lastConfirmedSignatureRef.current));
  const selectedPatientInitials = selectedPatientName.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'AT';
  const latestSelectedSession = packageSessions[0] || null;

  return (
    <div className="space-y-4 py-4">
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-status-blue-bg p-3 text-status-blue-text"><Images size={22} /></span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Álbuns externos por pacote</p>
                <h1 className="text-lg font-bold text-clinic-text sm:text-xl">Galeria externa de atividades</h1>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-sm text-clinic-text-muted">
              Selecione explicitamente um atendente para abrir o pacote atual. Os links são salvos automaticamente em lote após alguns segundos sem novas alterações.
            </p>
          </div>
        </div>
      </section>

      {!selectedPatientId && (
        <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-clinic-primary">Seleção obrigatória</p>
              <h2 className="mt-1 text-lg font-bold text-clinic-text">Selecione o atendente</h2>
              <p className="mt-1 text-sm text-clinic-text-muted">A galeria só carrega o pacote depois do clique no card do atendente.</p>
            </div>
            <label className="relative w-full lg:max-w-sm">
              <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Pesquisar por nome</span>
              <Search size={15} className="absolute bottom-3 left-3 text-clinic-text-faint" />
              <input
                value={patientSearch}
                onChange={event => setPatientSearch(event.target.value)}
                className="w-full rounded-xl border border-clinic-border bg-clinic-bg py-2.5 pl-9 pr-3 text-sm text-clinic-text"
                placeholder="Digite o nome do atendente"
              />
            </label>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {patientCards.map(patient => {
              const initials = patient.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'AT';
              return (
                <article
                  key={patient.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir galeria de ${patient.name}`}
                  onClick={() => selectPatient(patient.id)}
                  onKeyDown={event => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    selectPatient(patient.id);
                  }}
                  className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-clinic-border bg-white p-3 text-left shadow-sm transition hover:border-clinic-primary/35 hover:bg-clinic-bg/60 focus:outline-none focus:ring-2 focus:ring-clinic-primary focus:ring-offset-2 sm:p-4"
                >
                  <div
                    className="shrink-0"
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => event.stopPropagation()}
                  >
                    <PatientPhoto
                      patient={{
                        name: patient.name,
                        photoUrl: patient.photoUrl,
                        photoDriveFileId: patient.photoDriveFileId,
                      }}
                      alt={`Foto de ${patient.name}`}
                      expandable
                      className="h-14 w-14 rounded-2xl border border-clinic-border object-cover shadow-sm"
                      fallbackClassName="flex h-14 w-14 items-center justify-center rounded-2xl border border-clinic-border bg-clinic-bg text-sm font-black text-clinic-primary"
                      fallbackText={initials}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-clinic-text">{patient.name}</span>
                    <span className="mt-1 block text-xs text-clinic-text-muted">
                      Pacote atual {patient.packageNumber}{patient.progressLabel ? ` • ${patient.progressLabel}` : ''}
                    </span>
                    {patient.latestSessionDate && <span className="mt-1 block text-[11px] text-clinic-text-faint">Última sessão: {safeFormatDate(patient.latestSessionDate, 'dd/MM/yyyy')}</span>}
                    {patient.hasSessionToday && <span className="mt-2 inline-flex rounded-full bg-status-green-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-status-green-text">Sessão hoje</span>}
                  </div>
                </article>
              );
            })}
          </div>
          {patientCards.length === 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-6 text-center text-sm text-clinic-text-muted">
              Nenhum atendente encontrado para a pesquisa atual.
            </div>
          )}
        </section>
      )}

      {selectedPatientId && (
        <section className="sticky top-[72px] z-20 rounded-2xl border border-clinic-border bg-clinic-surface/95 p-4 shadow-clinic backdrop-blur sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <PatientPhoto
                patient={{
                  name: selectedPatientName,
                  photoUrl: selectedPatient?.photoUrl,
                  photoDriveFileId: selectedPatient?.photoDriveFileId,
                }}
                alt={`Foto de ${selectedPatientName}`}
                expandable
                className="h-14 w-14 shrink-0 rounded-2xl border border-clinic-border object-cover shadow-sm"
                fallbackClassName="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-clinic-border bg-clinic-bg text-sm font-black text-clinic-primary"
                fallbackText={selectedPatientInitials}
              />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wide text-clinic-primary">Atendente selecionado</p>
                <h2 className="truncate text-lg font-bold text-clinic-text">{selectedPatientName}</h2>
                <p className="text-xs text-clinic-text-muted">
                  Pacote atual {currentPackageNumber}
                  {latestSelectedSession ? ` • ${formatSessionNumbers([Number((latestSelectedSession as Session & { activitySessionNumber?: number }).activitySessionNumber || 0)]) || 'Sessão atual'} de 10` : ''}
                  {latestSelectedSession?.date ? ` • ${safeFormatDate(latestSelectedSession.date, 'dd/MM/yyyy')}` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${autosaveTone}`}>
                {autosaveStatus === 'saving' || autosaveStatus === 'switching' ? <Loader2 size={14} className="animate-spin" /> : autosaveStatus === 'error' || autosaveStatus === 'invalid' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                {autosaveLabel}
              </span>
              {showSaveNow && (
                <button type="button" onClick={() => void saveNow()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-clinic-primary disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Salvar agora
                </button>
              )}
              <button type="button" onClick={() => void returnToPatientSelection()} disabled={autosaveStatus === 'switching'} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-clinic-text-muted disabled:opacity-50">
                Trocar atendente
              </button>
            </div>
          </div>
        </section>
      )}

      {message && <div className="rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-3 text-sm font-bold text-status-green-text">{message}</div>}
      {error && <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">{error}</div>}

      {selectedPatientId && (
      <section className="rounded-2xl border border-clinic-border bg-clinic-surface p-4 shadow-clinic sm:p-5">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black text-clinic-text">Pacote atual {currentPackageNumber}</h2>
            <p className="text-xs text-clinic-text-muted">
              {loadingSessions
                ? 'Carregando sessões autorizadas...'
                : `${allCards.length} card(s) gerados, ${cardsWithLinksCount} com link salvo ou pendente.`}
              {hasLocalChanges ? ' Há alterações locais ainda não salvas.' : ''}
            </p>
          </div>
          <span className="rounded-full bg-clinic-bg px-3 py-1 text-xs font-bold text-clinic-text-muted">
            1 documento por pacote
          </span>
        </header>

        {loading && <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-bold text-clinic-text-muted"><Loader2 size={20} className="animate-spin" /> Carregando links do pacote...</div>}

        {!loading && allCards.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-8 text-center">
            <Images size={32} className="mx-auto text-clinic-text-faint" />
            <p className="mt-3 font-black text-clinic-text">Nenhuma sessão disponível no pacote atual</p>
            <p className="mt-1 text-sm text-clinic-text-muted">Quando uma sessão realizada ou em andamento existir, o card virtual aparecerá aqui.</p>
          </div>
        )}

        {!loading && allCards.length > 0 && (
          <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {allCards.map(card => {
              const normalizedUrl = normalizeAlbumUrl(card.url);
              const hasValidLink = Boolean(normalizedUrl);
              const cardHasInvalidLink = invalidCardIdSet.has(card.id);
              const editing = editingCardIds.includes(card.id);
              const sameDateSessions = packageSessions.filter(session => session.date === card.activityDate);
              const sessionLabel = formatSessionNumbers(card.sessionNumbers);
              return (
                <article key={card.id} className={`rounded-2xl border p-3 shadow-sm sm:p-4 ${cardHasInvalidLink ? 'border-status-orange-text/40 bg-status-orange-bg/70 ring-2 ring-status-orange-text/15' : card.status === 'hidden' ? 'border-amber-300 bg-amber-50/70' : hasValidLink ? 'border-clinic-border bg-white' : 'border-dashed border-clinic-border bg-clinic-bg/70'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${cardHasInvalidLink ? 'bg-status-orange-bg text-status-orange-text' : hasValidLink ? 'bg-status-green-bg text-status-green-text' : 'bg-clinic-bg text-clinic-text-muted'}`}>
                          {cardHasInvalidLink ? 'Link inválido' : hasValidLink ? 'Com link' : 'Sem link'}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${card.status === 'hidden' ? 'bg-amber-100 text-amber-800' : 'bg-status-blue-bg text-status-blue-text'}`}>{cardStatusLabel(card)}</span>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${card.visibleToGuardian ? 'bg-status-green-bg text-status-green-text' : 'bg-clinic-bg text-clinic-text-muted'}`}>{card.visibleToGuardian ? 'Visível ao responsável' : 'Somente equipe'}</span>
                      </div>
                      <h3 className="mt-3 break-words text-base font-bold text-clinic-text">{card.title || 'Atividade de Intervenção'}</h3>
                      <p className="mt-1 text-xs font-bold text-clinic-primary">
                        {sessionLabel ? `${sessionLabel} - ` : ''}{safeFormatDate(card.activityDate, 'dd/MM/yyyy')}{card.sessionTime ? ` às ${card.sessionTime}` : ''}
                      </p>
                    </div>
                    <span className="rounded-xl bg-clinic-bg p-2 text-clinic-primary"><CalendarDays size={17} /></span>
                  </div>

                  <dl className="mt-3 grid gap-2 text-sm">
                    <div><dt className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Categoria</dt><dd className="font-semibold text-clinic-text">{card.category}</dd></div>
                    {card.observation && <div><dt className="text-[10px] font-black uppercase text-clinic-text-faint">Observação</dt><dd className="whitespace-pre-wrap text-clinic-text-muted">{card.observation}</dd></div>}
                    {hasValidLink && <div><dt className="text-[10px] font-black uppercase text-clinic-text-faint">Publicado em</dt><dd className="text-clinic-text-muted">{safeFormatDate(card.publishedAt, 'dd/MM/yyyy')} • por {card.createdByName || card.updatedByName || currentUserName}</dd></div>}
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-clinic-border pt-3">
                    {hasValidLink ? (
                      <a href={normalizedUrl || card.url} target="_blank" rel="noopener noreferrer" className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-clinic-primary px-3 py-2.5 text-xs font-black text-white">
                        Abrir álbum <ExternalLink size={15} />
                      </a>
                    ) : permissions.canEdit ? (
                      <button type="button" onClick={() => openEditor(card)} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-clinic-primary px-3 py-2.5 text-xs font-black text-white">
                        {cardHasInvalidLink ? 'Corrigir link' : 'Adicionar link'} <Link2 size={15} />
                      </button>
                    ) : (
                      <span className="inline-flex flex-1 items-center justify-center rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs font-black text-clinic-text-muted">
                        Somente leitura
                      </span>
                    )}
                    {hasValidLink && permissions.canEdit && <button type="button" onClick={() => openEditor(card)} className="rounded-xl border border-clinic-border bg-white p-2.5 text-clinic-primary" aria-label="Editar card"><Pencil size={16} /></button>}
                    {hasValidLink && card.status === 'active' && permissions.canHide && <button type="button" onClick={() => updateCard(card, { status: 'hidden' })} className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-amber-800" aria-label="Ocultar card"><EyeOff size={16} /></button>}
                    {hasValidLink && card.status === 'hidden' && permissions.canReactivate && <button type="button" onClick={() => updateCard(card, { status: 'active' })} className="rounded-xl border border-status-green-text/20 bg-status-green-bg p-2.5 text-status-green-text" aria-label="Reativar card"><RotateCcw size={16} /></button>}
                    {hasValidLink && permissions.canRemove && <button type="button" onClick={() => clearCardLink(card)} className="rounded-xl border border-status-red-text/20 bg-status-red-bg p-2.5 text-status-red-text" aria-label="Remover vínculo"><Trash2 size={16} /></button>}
                  </div>

                  {editing && (
                    <div className="mt-3 space-y-3 rounded-xl border border-clinic-border bg-white p-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-black text-clinic-text">Título</span>
                        <input value={card.title} maxLength={120} disabled={!permissions.canEdit} onChange={event => updateCard(card, { title: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm text-clinic-text disabled:opacity-60" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-black text-clinic-text">Categoria</span>
                        <select value={card.category} disabled={!permissions.canEdit} onChange={event => updateCard(card, { category: event.target.value as ActivityRecordCategory })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm font-bold text-clinic-text disabled:opacity-60">
                          {ACTIVITY_RECORD_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-black text-clinic-text">Link</span>
                        <input type="url" inputMode="url" maxLength={2048} value={card.url} disabled={!permissions.canEdit} onChange={event => updateCard(card, { url: event.target.value })} className={`w-full rounded-xl border bg-clinic-bg px-3 py-2.5 text-sm text-clinic-text disabled:opacity-60 ${cardHasInvalidLink ? 'border-status-orange-text/60' : 'border-clinic-border'}`} placeholder="https://photos.app.goo.gl/..." />
                        {cardHasInvalidLink && <span className="mt-1 block text-xs font-bold text-status-orange-text">Use um link HTTPS válido de photos.app.goo.gl.</span>}
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                          <span className="mb-1 block text-xs font-black text-clinic-text">Data de publicação</span>
                          <input type="date" value={card.publishedAt || todayIsoDate()} disabled={!permissions.canEdit} onChange={event => updateCard(card, { publishedAt: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm font-bold text-clinic-text disabled:opacity-60" />
                        </label>
                        <label className="flex items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5">
                          <input type="checkbox" checked={card.visibleToGuardian} disabled={!permissions.canEdit} onChange={event => updateCard(card, { visibleToGuardian: event.target.checked })} />
                          <span className="text-sm font-bold text-clinic-text">Visível para o responsável</span>
                        </label>
                      </div>
                      {sameDateSessions.length > 1 && (
                        <fieldset className="rounded-xl border border-clinic-border bg-clinic-bg p-3">
                          <legend className="px-1 text-xs font-black text-clinic-text">Sessões vinculadas</legend>
                          <p className="mb-2 text-xs text-clinic-text-muted">Agrupe apenas sessões da mesma data que representam a mesma atividade.</p>
                          <div className="grid gap-2">
                            {sameDateSessions.map(session => (
                              <label key={session.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-clinic-text">
                                <input
                                  type="checkbox"
                                  checked={card.sessionIds.includes(session.id)}
                                  disabled={!permissions.canEdit}
                                  onChange={event => {
                                    const next = new Set<string>(card.sessionIds);
                                    if (event.target.checked) next.add(session.id);
                                    else next.delete(session.id);
                                    updateCardSessions(card, [...next]);
                                  }}
                                />
                                {safeFormatDate(session.date, 'dd/MM/yyyy')} às {session.time} • {session.status}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      )}
                      <label className="block">
                        <span className="mb-1 block text-xs font-black text-clinic-text">Observação</span>
                        <textarea maxLength={1000} rows={3} value={card.observation} disabled={!permissions.canEdit} onChange={event => updateCard(card, { observation: event.target.value })} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm text-clinic-text disabled:opacity-60" />
                      </label>
                      <div className="flex justify-end">
                        <button type="button" onClick={() => closeEditor(card.id)} className="rounded-xl border border-clinic-border bg-white px-4 py-2.5 text-xs font-black text-clinic-text-muted">Concluir edição local</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {selectedPatientId && <section className="rounded-2xl border border-status-blue-text/20 bg-status-blue-bg p-4 text-sm text-status-blue-text">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0" />
          <div><p className="font-black">Economia e privacidade</p><p className="mt-1">Cards vazios ficam apenas na tela. O salvamento grava um único documento do pacote e não carrega fotos, vídeos, miniaturas ou metadados remotos.</p></div>
        </div>
      </section>}
    </div>
  );
}
