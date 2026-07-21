import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderPlus,
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
  X,
} from 'lucide-react';
import type { Patient, Payment, Session } from '../../types';
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
  createGooglePhotosAlbum,
  listGooglePhotosAlbumPatientOptions,
  listGooglePhotosAlbumSessionOptions,
  listGooglePhotosAlbums,
  saveGooglePhotosAlbumPackage,
} from '../../lib/googlePhotosAlbumsApi';
import { buildActivityMediaPackageModel } from '../../lib/activityMediaPackages';
import { buildEffectiveSessionHistory } from '../../lib/sessionSequence';
import { safeFormatDate } from '../../lib/utils';
import PatientPhoto from '../Common/PatientPhoto';
import {
  buildGooglePhotosAlbumGroupKey,
  buildGooglePhotosAlbumPackageKey,
  buildGooglePhotosVirtualAlbumCards,
  getGooglePhotosAlbumDisplayTitle,
  hasGooglePhotosAlbumEditorChanges,
  mergeGooglePhotosAlbumCards,
  normalizeGooglePhotosAlbumUrl,
} from '../../../shared/googlePhotosAlbums.js';

interface Props {
  patients: Patient[];
  sessions: Session[];
  payments: Payment[];
  currentUserName: string;
  initialPatientId?: string | null;
  initialSessionId?: string | null;
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
const getAlbumDisplayTitle = getGooglePhotosAlbumDisplayTitle as (album: GooglePhotosAlbum) => string;
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'invalid' | 'error';

function todayIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function isSafeIsoDate(value = ''): boolean {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay;
}

function isoToDisplayDate(value = ''): string {
  if (!isSafeIsoDate(value)) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function normalizeDisplayDateInput(value = ''): string {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (/^\d{8}$/.test(raw) || (digits.length === 8 && !raw.includes('/'))) {
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }
  return raw.replace(/[^\d/]/g, '').slice(0, 10);
}

function displayDateToIso(value = ''): { iso: string; error: string } {
  const normalized = normalizeDisplayDateInput(value);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return { iso: '', error: 'Informe a data de publicação no formato DD/MM/AAAA.' };
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  if (!isSafeIsoDate(iso)) return { iso: '', error: 'Informe uma data de publicação real.' };
  return { iso, error: '' };
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
    publishedAt: card.publishedAt || '',
    status: card.status,
  };
}

function buildEditorInitialCard(card: GooglePhotosAlbum): GooglePhotosAlbum {
  const authorizeNewLinkByDefault = !card.url.trim() && card.status !== 'hidden';
  return {
    ...card,
    visibleToGuardian: authorizeNewLinkByDefault ? true : card.visibleToGuardian,
    publishedAt: card.publishedAt || card.activityDate || '',
    isVirtual: false,
  };
}

export default function ProfessionalGooglePhotosGallery({
  patients,
  sessions,
  payments,
  currentUserName,
  initialPatientId = null,
  initialSessionId = null,
}: Props) {
  const [patientOptions, setPatientOptions] = useState<Array<{ id: string; name: string }>>(() => patients.map(patient => ({ id: patient.id, name: patient.fullName || patient.name })));
  const [remoteSessions, setRemoteSessions] = useState<Session[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState(() => String(initialPatientId || '').trim());
  const [patientSearch, setPatientSearch] = useState('');
  const [persistedCards, setPersistedCards] = useState<GooglePhotosAlbum[]>([]);
  const [draftCards, setDraftCards] = useState<Record<string, GooglePhotosAlbum>>({});
  const [removedCardIds, setRemovedCardIds] = useState<string[]>([]);
  const [editingCardIds, setEditingCardIds] = useState<string[]>([]);
  const [expandedObservationIds, setExpandedObservationIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<GooglePhotosAlbumCapabilities>(EMPTY_PERMISSIONS);
  const [ownerUserId, setOwnerUserId] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creatingCardIds, setCreatingCardIds] = useState<string[]>([]);
  const [quickCreateCardId, setQuickCreateCardId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savingRef = useRef(false);
  const creatingCardIdsRef = useRef(new Set<string>());
  const lastConfirmedSignatureRef = useRef('[]');
  const allCardsRef = useRef<GooglePhotosAlbum[]>([]);
  const selectedPatientIdRef = useRef('');
  const currentPackageNumberRef = useRef(0);
  const permissionsRef = useRef(EMPTY_PERMISSIONS);
  const initialSessionHandledRef = useRef(false);
  const editorBaselineRef = useRef<Record<string, GooglePhotosAlbum>>({});

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
        const model = buildActivityMediaPackageModel({ patientId: option.id, sessions: patientSessions, payments });
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
  }, [patientOptions, patientSearch, patients, payments, sessions]);

  const sessionSource = useMemo(() => {
    const local = sessions.filter(session => session.patientId === selectedPatientId);
    return local.length > 0 ? local : remoteSessions.filter(session => session.patientId === selectedPatientId);
  }, [remoteSessions, selectedPatientId, sessions]);

  const packageModel = useMemo(() => buildActivityMediaPackageModel({
    patientId: selectedPatientId,
    sessions: sessionSource,
    payments,
  }), [payments, selectedPatientId, sessionSource]);

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
      patientDoubleSession: Boolean(selectedPatient?.doubleSession),
      packageNumber: currentPackageNumber,
      payments,
    }) as GooglePhotosAlbum[]
  ), [currentPackageNumber, payments, selectedPatient?.doubleSession, selectedPatientId, selectedPatientName, sessionSource]);

  const allCards = useMemo(() => (
    mergeGooglePhotosAlbumCards({
      virtualCards,
      persistedCards,
      draftCards: Object.values(draftCards),
      removedCardIds,
    }) as GooglePhotosAlbum[]
  ), [draftCards, persistedCards, removedCardIds, virtualCards]);

  const effectiveSessionHistory = useMemo(() => buildEffectiveSessionHistory(sessionSource, {
    patientId: selectedPatientId,
    throughDate: todayIsoDate(),
    activities: allCards
      .filter(card => Boolean(normalizeAlbumUrl(card.url)))
      .map(card => ({ id: card.id, sessionId: card.sessionId, sessionIds: card.sessionIds })),
  }).filter(item => (
    item.packageNumber === currentPackageNumber
    && (
      item.consumesPackage
      || item.originalStatus === 'Falta'
      || item.originalStatus === 'late_cancellation_no_replacement'
      || item.originalStatus === 'Falta.Prof'
    )
  )), [allCards, currentPackageNumber, selectedPatientId, sessionSource]);

  const canCreateAlbum = permissions.canCreate || permissions.canEdit;
  const creatableCards = useMemo(() => allCards.filter(card => (
    !normalizeAlbumUrl(card.url)
    && card.status !== 'removed'
    && Array.isArray(card.sessionIds)
    && card.sessionIds.length > 0
  )), [allCards]);
  const quickCreateCard = useMemo(
    () => creatableCards.find(card => card.id === quickCreateCardId) || null,
    [creatableCards, quickCreateCardId],
  );

  useEffect(() => {
    if (quickCreateCardId && !creatableCards.some(card => card.id === quickCreateCardId)) {
      setQuickCreateCardId('');
    }
  }, [creatableCards, quickCreateCardId]);

  const editorSourceCards = useMemo(() => (
    mergeGooglePhotosAlbumCards({
      virtualCards,
      persistedCards,
      draftCards: [],
      removedCardIds: [],
    }) as GooglePhotosAlbum[]
  ), [persistedCards, virtualCards]);
  const editorSourceById = useMemo(
    () => new Map(editorSourceCards.map(card => [card.id, card])),
    [editorSourceCards],
  );
  const hasLocalChanges = useMemo(() => (
    removedCardIds.length > 0
    || Object.entries(draftCards).some(([cardId, draftCard]) => {
      const baseline = editorBaselineRef.current[cardId]
        || (editorSourceById.get(cardId) ? buildEditorInitialCard(editorSourceById.get(cardId)!) : null);
      return !baseline || hasGooglePhotosAlbumEditorChanges(draftCard, baseline);
    })
  ), [draftCards, editorSourceById, removedCardIds]);
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
      setExpandedObservationIds([]);
      editorBaselineRef.current = {};
      setSaveStatus('idle');
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
    setQuickCreateCardId('');
    setPersistedCards([]);
    setDraftCards({});
    setRemovedCardIds([]);
    setEditingCardIds([]);
    setExpandedObservationIds([]);
    editorBaselineRef.current = {};
    setOwnerUserId('');
    setSaveStatus('idle');
    lastConfirmedSignatureRef.current = '[]';
    setMessage('');
    setError('');
  };

  const discardAllDrafts = useCallback(() => {
    setDraftCards({});
    setRemovedCardIds([]);
    setEditingCardIds([]);
    setExpandedObservationIds([]);
    editorBaselineRef.current = {};
    setSaveStatus('idle');
    setError('');
  }, []);

  const confirmDiscardChanges = useCallback(() => (
    !hasLocalChanges || window.confirm('Existem alterações não salvas. Deseja descartá-las?')
  ), [hasLocalChanges]);

  const hasUnsavedChangesForCard = useCallback((cardId: string): boolean => {
    const draft = draftCards[cardId];
    if (!draft) return false;
    const source = editorSourceById.get(cardId);
    const baseline = editorBaselineRef.current[cardId]
      || (source ? buildEditorInitialCard(source) : null);
    return !baseline || hasGooglePhotosAlbumEditorChanges(draft, baseline);
  }, [draftCards, editorSourceById]);

  const openEditor = (card: GooglePhotosAlbum) => {
    if (hasLocalChanges && !editingCardIds.includes(card.id)) {
      if (!confirmDiscardChanges()) return;
      discardAllDrafts();
    }
    const initialCard = buildEditorInitialCard(card);
    if (!draftCards[card.id]) editorBaselineRef.current[card.id] = initialCard;
    setEditingCardIds(current => current.includes(card.id) ? current : [...current, card.id]);
    setExpandedObservationIds(current => current.filter(id => id !== card.id));
    setDraftCards(current => current[card.id] ? current : {
      ...current,
      [card.id]: initialCard,
    });
    setMessage('');
  };


  useEffect(() => {
    if (initialSessionHandledRef.current || !initialSessionId || !selectedPatientId || loading || allCards.length === 0) return;
    const targetCard = allCards.find(card => card.sessionIds.includes(initialSessionId));
    if (!targetCard) return;
    initialSessionHandledRef.current = true;
    openEditor(targetCard);
    window.setTimeout(() => {
      document.getElementById(`google-photos-card-${encodeURIComponent(targetCard.id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }, [allCards, initialSessionId, loading, selectedPatientId]);

  const closeEditor = (cardId: string) => {
    if (hasUnsavedChangesForCard(cardId) && !window.confirm('Existem alterações não salvas. Deseja descartá-las?')) return;
    setDraftCards(current => {
      if (!current[cardId]) return current;
      const copy = { ...current };
      delete copy[cardId];
      return copy;
    });
    delete editorBaselineRef.current[cardId];
    setEditingCardIds(current => current.filter(id => id !== cardId));
    setExpandedObservationIds(current => current.filter(id => id !== cardId));
    setMessage('');
  };

  const toggleObservation = (cardId: string) => {
    setExpandedObservationIds(current => current.includes(cardId)
      ? current.filter(id => id !== cardId)
      : [...current, cardId]);
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
    setSaveStatus('dirty');
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

  const createAlbumForCard = useCallback(async (card: GooglePhotosAlbum): Promise<void> => {
    if (!(permissionsRef.current.canCreate || permissionsRef.current.canEdit) || normalizeAlbumUrl(card.url)) return;
    if (creatingCardIdsRef.current.has(card.id)) return;
    if (savingRef.current) {
      setError('Aguarde o salvamento atual terminar antes de criar o álbum.');
      return;
    }
    const title = String(card.title || '').trim();
    if (!title) {
      setError('Informe o título do álbum antes de criar.');
      openEditor(card);
      return;
    }
    if (!Array.isArray(card.sessionIds) || card.sessionIds.length === 0) {
      setError('O card precisa estar vinculado a uma sessão válida.');
      return;
    }

    creatingCardIdsRef.current.add(card.id);
    setCreatingCardIds(current => current.includes(card.id) ? current : [...current, card.id]);
    setError('');
    setMessage('');
    try {
      const creationPayload = {
        patientId: card.patientId,
        packageNumber: card.packageNumber,
        sessionIds: card.sessionIds,
        sessionGroupKey: card.sessionGroupKey,
        activityDate: card.activityDate,
        title,
        category: card.category,
        observation: card.observation,
        publishedAt: card.publishedAt || card.activityDate,
      };
      let result = await createGooglePhotosAlbum(creationPayload);
      if (result.createdAlbum.idempotent && result.createdAlbum.recreationAvailable) {
        const confirmed = typeof window !== 'undefined' && window.confirm(
          'O sistema encontrou o registro de uma criação anterior, mas este card está sem link. '
          + 'Use esta opção somente se o álbum anterior foi excluído manualmente no Google Fotos. '
          + 'Deseja criar um novo álbum vazio para esta mesma sessão?',
        );
        if (!confirmed) {
          setMessage('A criação anterior foi mantida. Nenhum novo álbum foi criado.');
          setSaveStatus('idle');
          return;
        }
        result = await createGooglePhotosAlbum({
          ...creationPayload,
          recreateDeletedAlbum: true,
        });
      }

      if (
        selectedPatientIdRef.current === card.patientId
        && currentPackageNumberRef.current === card.packageNumber
      ) {
        setPersistedCards(result.albums);
        setPermissions(result.permissions);
        setOwnerUserId(result.ownerUserId || ownerUserId);
        setDraftCards(current => {
          if (!current[card.id]) return current;
          const next = { ...current };
          delete next[card.id];
          return next;
        });
        setRemovedCardIds(current => current.filter(id => id !== card.id));
        setEditingCardIds(current => current.filter(id => id !== card.id));
        setExpandedObservationIds(current => current.filter(id => id !== card.id));
        delete editorBaselineRef.current[card.id];
        lastConfirmedSignatureRef.current = JSON.stringify(buildSavableInputs(result.albums));
        if (draftStorageKey && typeof window !== 'undefined') window.sessionStorage.removeItem(draftStorageKey);
      }
      setQuickCreateCardId(current => current === card.id ? '' : current);
      setSaveStatus('idle');
      setMessage(result.createdAlbum.recreated
        ? 'Novo álbum vazio criado para substituir o álbum que havia sido excluído manualmente.'
        : result.createdAlbum.idempotent
          ? 'Este álbum já havia sido criado. O link existente foi recuperado sem duplicação.'
          : 'Álbum vazio criado com sucesso. Ele continua restrito à conta Google e ainda não foi compartilhado com o responsável.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível criar o álbum no Google Fotos.');
      setSaveStatus('error');
    } finally {
      creatingCardIdsRef.current.delete(card.id);
      setCreatingCardIds(current => current.filter(id => id !== card.id));
    }
  }, [buildSavableInputs, draftStorageKey, ownerUserId]);

  const validateEditedCards = useCallback((): string => {
    if (hasInvalidLinks) return 'Use um link HTTPS válido de photos.app.goo.gl antes de salvar.';
    const editedCards = allCardsRef.current.filter(card => draftCards[card.id] || card.url.trim());
    for (const card of editedCards) {
      const removingExistingLink = !String(card.url || '').trim()
        && persistedCards.some(persisted => persisted.id === card.id && Boolean(normalizeAlbumUrl(persisted.url)));
      if (removingExistingLink) continue;
      if (!String(card.title || '').trim()) return 'Informe o título da publicação.';
      if (!String(card.category || '').trim()) return 'Selecione a categoria da publicação.';
      if (!String(card.url || '').trim()) return 'Informe o link da publicação antes de salvar.';
      if (!normalizeAlbumUrl(card.url)) return 'Informe um link HTTPS legítimo do Google Fotos.';
      if (!Array.isArray(card.sessionIds) || card.sessionIds.length === 0) {
        return 'Cada publicação precisa estar vinculada a uma sessão válida.';
      }
      if (!String(card.publishedAt || '').trim()) return 'Informe a Data de publicação.';
      if (!isSafeIsoDate(card.publishedAt)) return 'Informe uma Data de publicação real no formato DD/MM/AAAA.';
    }
    return '';
  }, [draftCards, hasInvalidLinks, persistedCards]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (!selectedPatientIdRef.current || !currentPackageNumberRef.current || !permissionsRef.current.canEdit) return true;
    if (savingRef.current) {
      return false;
    }
    const validationError = validateEditedCards();
    if (validationError) {
      setError(validationError);
      setSaveStatus('invalid');
      return false;
    }
    const cardsWithLinks = buildSavableInputs(allCardsRef.current);
    const nextSignature = JSON.stringify(cardsWithLinks);
    if (nextSignature === lastConfirmedSignatureRef.current && !hasLocalChanges) {
      setDraftCards({});
      setEditingCardIds([]);
      setExpandedObservationIds([]);
      editorBaselineRef.current = {};
      if (draftStorageKey && typeof window !== 'undefined') window.sessionStorage.removeItem(draftStorageKey);
      setSaveStatus('idle');
      setMessage('Nenhuma alteração pendente.');
      return true;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    setSaveStatus('saving');
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
      setExpandedObservationIds([]);
      editorBaselineRef.current = {};
      lastConfirmedSignatureRef.current = JSON.stringify(buildSavableInputs(result.albums));
      if (draftStorageKey && typeof window !== 'undefined') window.sessionStorage.removeItem(draftStorageKey);
      setSaveStatus('idle');
      setMessage('Tudo salvo.');
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Não foi possível salvar os links do pacote.');
      setSaveStatus('error');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [buildSavableInputs, draftStorageKey, hasLocalChanges, validateEditedCards]);

  useEffect(() => {
    if (!draftStorageKey || typeof window === 'undefined') return;
    if (!hasLocalChanges) {
      window.sessionStorage.removeItem(draftStorageKey);
      return;
    }
    window.sessionStorage.setItem(draftStorageKey, JSON.stringify({ draftCards, removedCardIds }));
  }, [draftCards, draftStorageKey, hasLocalChanges, removedCardIds]);

  useEffect(() => {
    if (saveStatus === 'saving' || saveStatus === 'error') return;
    if (hasInvalidLinks) {
      setSaveStatus('invalid');
      return;
    }
    setSaveStatus(hasLocalChanges ? 'dirty' : 'idle');
  }, [hasInvalidLinks, hasLocalChanges, saveStatus]);

  useEffect(() => {
    const shouldWarn = hasLocalChanges || saveStatus === 'saving' || saveStatus === 'error';
    if (!shouldWarn) return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasLocalChanges, saveStatus]);

  const returnToPatientSelection = useCallback(() => {
    if (savingRef.current) return;
    if (!confirmDiscardChanges()) return;
    setSelectedPatientId('');
    setQuickCreateCardId('');
    setPersistedCards([]);
    setDraftCards({});
    setRemovedCardIds([]);
    setEditingCardIds([]);
    setExpandedObservationIds([]);
    editorBaselineRef.current = {};
    setOwnerUserId('');
    setSaveStatus('idle');
    setMessage('');
    setError('');
  }, [confirmDiscardChanges]);

  const cardsWithLinksCount = allCards.filter(card => card.url.trim()).length;
  const saveLabel = saveStatus === 'saving'
    ? 'Salvando...'
    : saveStatus === 'dirty'
      ? 'Alterações pendentes'
      : saveStatus === 'invalid'
        ? 'Revise os campos destacados'
        : saveStatus === 'error'
          ? 'Não foi possível salvar'
          : 'Tudo salvo';
  const saveTone = saveStatus === 'error' || saveStatus === 'invalid'
    ? 'border-status-orange-text/30 bg-status-orange-bg text-status-orange-text'
    : saveStatus === 'saving' || saveStatus === 'dirty'
      ? 'border-status-blue-text/20 bg-status-blue-bg text-status-blue-text'
      : 'border-status-green-text/20 bg-status-green-bg text-status-green-text';
  const showSaveNow = permissions.canEdit && (saveStatus === 'dirty' || saveStatus === 'invalid' || saveStatus === 'error' || hasLocalChanges);
  const selectedPatientInitials = selectedPatientName.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'AT';
  const latestEffectiveSession = effectiveSessionHistory.at(-1) || null;
  const latestSelectedSession = packageSessions.at(-1) || null;

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
              Selecione explicitamente um atendente para abrir o pacote atual. As publicações só são gravadas quando o botão Salvar é acionado.
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
                  {latestEffectiveSession ? ` • Sessão ${latestEffectiveSession.sessionNumber} de 10` : latestSelectedSession ? ` • ${formatSessionNumbers([Number((latestSelectedSession as Session & { activitySessionNumber?: number }).activitySessionNumber || 0)]) || 'Sessão atual'} de 10` : ''}
                  {latestEffectiveSession?.date ? ` • ${safeFormatDate(latestEffectiveSession.date, 'dd/MM/yyyy')}` : latestSelectedSession?.date ? ` • ${safeFormatDate(latestSelectedSession.date, 'dd/MM/yyyy')}` : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${saveTone}`}>
                {saveStatus === 'saving' ? <Loader2 size={14} className="animate-spin" /> : saveStatus === 'error' || saveStatus === 'invalid' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                {saveLabel}
              </span>
              {showSaveNow && (
                <button type="button" onClick={() => void saveNow()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-clinic-primary disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Salvar
                </button>
              )}
              <button type="button" onClick={() => returnToPatientSelection()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-clinic-text-muted disabled:opacity-50">
                Trocar atendente
              </button>
            </div>
          </div>
        </section>
      )}

      {selectedPatientId && !loading && canCreateAlbum && (
        <section className="rounded-2xl border border-clinic-primary/25 bg-clinic-surface p-4 shadow-clinic sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-clinic-primary">
                <FolderPlus size={20} />
                <h2 className="text-base font-black">Criar álbum no Google Fotos</h2>
              </div>
              <p className="mt-1 text-sm text-clinic-text-muted">
                Escolha a sessão deste atendente e pacote. A ação cria somente um álbum vazio, sem enviar ou compartilhar mídias.
              </p>
            </div>
            {creatableCards.length > 0 ? (
              <div className="grid w-full gap-2 sm:grid-cols-[minmax(220px,1fr)_auto] xl:max-w-2xl">
                <label className="block">
                  <span className="sr-only">Sessão para criação do álbum</span>
                  <select
                    value={quickCreateCardId}
                    onChange={event => setQuickCreateCardId(event.target.value)}
                    disabled={saving || creatingCardIds.length > 0}
                    className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm font-bold text-clinic-text disabled:opacity-60"
                  >
                    <option value="">Selecione a sessão</option>
                    {creatableCards.map(card => (
                      <option key={card.id} value={card.id}>
                        {formatSessionNumbers(card.sessionNumbers) || 'Sessão'} - {safeFormatDate(card.activityDate, 'dd/MM/yyyy')}{card.sessionTime ? ` às ${card.sessionTime}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (quickCreateCard) void createAlbumForCard(quickCreateCard);
                  }}
                  disabled={!quickCreateCard || saving || Boolean(quickCreateCard && creatingCardIds.includes(quickCreateCard.id))}
                  className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {quickCreateCard && creatingCardIds.includes(quickCreateCard.id) ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />}
                  {quickCreateCard && creatingCardIds.includes(quickCreateCard.id) ? 'Criando álbum...' : 'Criar álbum no Google Fotos'}
                </button>
              </div>
            ) : allCards.length === 0 ? (
              <div className="rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm font-bold text-clinic-text-muted">
                Nenhuma sessão realizada ou em andamento está disponível para criar álbum neste pacote.
              </div>
            ) : (
              <div className="rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-3 text-sm font-bold text-status-green-text">
                Todos os cards disponíveis deste pacote já possuem link de álbum.
              </div>
            )}
          </div>
        </section>
      )}

      {message && <div className="rounded-xl border border-status-green-text/20 bg-status-green-bg px-4 py-3 text-sm font-bold text-status-green-text">{message}</div>}
      {error && <div className="rounded-xl border border-status-red-text/20 bg-status-red-bg px-4 py-3 text-sm font-bold text-status-red-text">{error}</div>}
      {selectedPatientId && (packageModel.awaitingPaymentSessions?.length || 0) > 0 && (
        <div className="rounded-xl border border-status-orange-text/25 bg-status-orange-bg px-4 py-3 text-sm font-bold text-status-orange-text">
          Há {packageModel.awaitingPaymentSessions?.length} sessão(ões) além do pacote atual aguardando o pagamento do próximo pacote. Nenhum novo pacote foi aberto.
        </div>
      )}

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

        {!loading && effectiveSessionHistory.length > 0 && (
          <div className="mt-5 rounded-2xl border border-clinic-border bg-clinic-bg/45 p-3 sm:p-4">
            <div className="flex items-center gap-2">
              <CalendarDays size={17} className="text-clinic-primary" />
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-clinic-text">Histórico efetivo de sessões</h3>
                <p className="text-[10px] text-clinic-text-muted">Sessões consumidas e faltas aparecem no histórico; ausências nunca admitem atividade ou mídia.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {effectiveSessionHistory.map(item => {
                const countedAbsence = item.presentationStatus === 'Falta contabilizada';
                return (
                  <article key={item.sessionId} className={`rounded-xl border p-3 ${countedAbsence ? 'border-[#A94444]/30 bg-[#FFF4F4]' : 'border-clinic-border bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-clinic-text">Sessão {item.sessionNumber}</p>
                        <p className="mt-0.5 text-xs text-clinic-text-muted">{safeFormatDate(item.date, 'dd/MM/yyyy')} às {item.time}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${countedAbsence ? 'bg-white text-[#A94444]' : item.sessionKind === 'replacement' ? 'bg-status-orange-bg text-status-orange-text' : 'bg-status-green-bg text-status-green-text'}`}>
                        {item.presentationStatus}
                      </span>
                    </div>
                    <p className={`mt-2 text-[10px] font-bold ${item.hasActivity ? 'text-status-green-text' : 'text-clinic-text-muted'}`}>
                      {item.hasActivity ? `${item.activityCount} ${item.activityCount === 1 ? 'atividade' : 'atividades'}` : 'Sem atividade registrada'}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {loading && <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-bold text-clinic-text-muted"><Loader2 size={20} className="animate-spin" /> Carregando links do pacote...</div>}

        {!loading && allCards.length === 0 && (
          <div className="mt-5 rounded-xl border border-dashed border-clinic-border bg-clinic-bg p-8 text-center">
            <Images size={32} className="mx-auto text-clinic-text-faint" />
            <p className="mt-3 font-black text-clinic-text">Nenhuma atividade disponível no pacote atual</p>
            <p className="mt-1 text-sm text-clinic-text-muted">Quando uma sessão realizada ou em andamento admitir atividade, o card virtual aparecerá aqui.</p>
          </div>
        )}

        {!loading && allCards.length > 0 && (
          <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {allCards.map(card => {
              const normalizedUrl = normalizeAlbumUrl(card.url);
              const hasValidLink = Boolean(normalizedUrl);
              const cardHasInvalidLink = invalidCardIdSet.has(card.id);
              const editing = editingCardIds.includes(card.id);
              const creatingAlbum = creatingCardIds.includes(card.id);
              const sessionLabel = formatSessionNumbers(card.sessionNumbers);
              const publishedAtDisplay = isSafeIsoDate(card.publishedAt) ? isoToDisplayDate(card.publishedAt) : card.publishedAt || '';
              const observationExpanded = expandedObservationIds.includes(card.id);
              const datePickerId = `google-photos-published-at-${encodeURIComponent(card.id)}`;
              return (
                <article id={`google-photos-card-${encodeURIComponent(card.id)}`} key={card.id} className={`rounded-2xl border p-3 shadow-sm sm:p-4 ${cardHasInvalidLink ? 'border-status-orange-text/40 bg-status-orange-bg/70 ring-2 ring-status-orange-text/15' : card.status === 'hidden' ? 'border-amber-300 bg-amber-50/70' : hasValidLink ? 'border-clinic-border bg-white' : 'border-dashed border-clinic-border bg-clinic-bg/70'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${cardHasInvalidLink ? 'bg-status-orange-bg text-status-orange-text' : hasValidLink ? 'bg-status-green-bg text-status-green-text' : 'bg-clinic-bg text-clinic-text-muted'}`}>
                          {cardHasInvalidLink ? 'Link inválido' : hasValidLink ? 'Com link' : 'Sem link'}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${card.status === 'hidden' ? 'bg-amber-100 text-amber-800' : 'bg-status-blue-bg text-status-blue-text'}`}>{cardStatusLabel(card)}</span>
                        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${card.visibleToGuardian ? 'bg-status-green-bg text-status-green-text' : 'bg-clinic-bg text-clinic-text-muted'}`}>{card.visibleToGuardian ? 'Visível ao responsável' : 'Somente equipe'}</span>
                      </div>
                      <h3 className="mt-3 break-words text-base font-bold text-clinic-text">{getAlbumDisplayTitle(card) || 'Atividade de Intervenção'}</h3>
                      <p className="mt-1 text-xs font-bold text-clinic-primary">
                        {card.sessionIds.length > 1 ? 'Sessão dupla • 2 sessões vinculadas - ' : sessionLabel ? `${sessionLabel} - ` : ''}{safeFormatDate(card.activityDate, 'dd/MM/yyyy')}{card.sessionTime ? ` às ${card.sessionTime}` : ''}
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
                    ) : (
                      <>
                        {canCreateAlbum && (
                          <button
                            type="button"
                            onClick={() => void createAlbumForCard(card)}
                            disabled={creatingAlbum || saving}
                            className="inline-flex flex-[2] items-center justify-center gap-2 rounded-xl bg-clinic-primary px-3 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {creatingAlbum ? <Loader2 size={15} className="animate-spin" /> : <FolderPlus size={15} />}
                            {creatingAlbum ? 'Criando álbum...' : 'Criar álbum no Google Fotos'}
                          </button>
                        )}
                        {permissions.canEdit ? (
                          <button type="button" onClick={() => openEditor(card)} disabled={creatingAlbum} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-xs font-black text-clinic-primary disabled:opacity-50">
                            {cardHasInvalidLink ? 'Corrigir link' : 'Adicionar link'} <Link2 size={15} />
                          </button>
                        ) : !canCreateAlbum ? (
                          <span className="inline-flex flex-1 items-center justify-center rounded-xl border border-clinic-border bg-clinic-bg px-3 py-2.5 text-xs font-black text-clinic-text-muted">
                            Somente leitura
                          </span>
                        ) : null}
                      </>
                    )}
                    {hasValidLink && permissions.canEdit && <button type="button" onClick={() => editing ? closeEditor(card.id) : openEditor(card)} className="rounded-xl border border-clinic-border bg-white p-2.5 text-clinic-primary" aria-label={editing ? 'Fechar edição' : 'Editar card'} title={editing ? 'Fechar edição' : 'Editar card'}>{editing ? <X size={16} /> : <Pencil size={16} />}</button>}
                    {hasValidLink && card.status === 'active' && permissions.canHide && <button type="button" onClick={() => updateCard(card, { status: 'hidden' })} className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-amber-800" aria-label="Ocultar card"><EyeOff size={16} /></button>}
                    {hasValidLink && card.status === 'hidden' && permissions.canReactivate && <button type="button" onClick={() => updateCard(card, { status: 'active' })} className="rounded-xl border border-status-green-text/20 bg-status-green-bg p-2.5 text-status-green-text" aria-label="Reativar card"><RotateCcw size={16} /></button>}
                    {hasValidLink && permissions.canRemove && <button type="button" onClick={() => clearCardLink(card)} className="rounded-xl border border-status-red-text/20 bg-status-red-bg p-2.5 text-status-red-text" aria-label="Remover vínculo"><Trash2 size={16} /></button>}
                  </div>

                  {editing && (
                    <div className="mt-3 space-y-2 rounded-xl border border-clinic-border bg-white p-2.5">
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-black text-clinic-text">Título</span>
                          <input value={card.title} maxLength={120} disabled={!permissions.canEdit} onChange={event => updateCard(card, { title: event.target.value })} className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2 text-sm text-clinic-text disabled:opacity-60" />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-black text-clinic-text">Categoria</span>
                          <select value={card.category} disabled={!permissions.canEdit} onChange={event => updateCard(card, { category: event.target.value as ActivityRecordCategory })} className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2 text-sm font-bold text-clinic-text disabled:opacity-60">
                            {ACTIVITY_RECORD_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                          </select>
                        </label>
                      </div>

                      <label className="flex items-center gap-3 rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2">
                        <input type="checkbox" checked={card.visibleToGuardian} disabled={!permissions.canEdit} onChange={event => updateCard(card, { visibleToGuardian: event.target.checked })} />
                        <span className="text-sm font-bold text-clinic-text">Visível para o responsável</span>
                      </label>

                      <div className="rounded-lg border border-clinic-border bg-clinic-bg">
                        <button
                          type="button"
                          onClick={() => toggleObservation(card.id)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                          aria-expanded={observationExpanded}
                          aria-controls={`google-photos-observation-${encodeURIComponent(card.id)}`}
                        >
                          <span className="text-[11px] font-black text-clinic-text">Observação</span>
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-clinic-primary">
                            {observationExpanded ? 'Ocultar observação' : 'Mostrar observação'}
                            {observationExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </span>
                        </button>
                        {observationExpanded && (
                          <label id={`google-photos-observation-${encodeURIComponent(card.id)}`} className="block border-t border-clinic-border p-2">
                            <span className="sr-only">Observação da publicação</span>
                            <textarea maxLength={1000} rows={2} value={card.observation} disabled={!permissions.canEdit} onChange={event => updateCard(card, { observation: event.target.value })} className="w-full resize-y rounded-lg border border-clinic-border bg-white px-3 py-2 text-sm text-clinic-text disabled:opacity-60" placeholder="Digite uma observação somente quando necessário." />
                          </label>
                        )}
                      </div>

                      <label className="block">
                        <span className="mb-1 block text-[11px] font-black text-clinic-text">Data de publicação</span>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={10}
                            value={publishedAtDisplay}
                            disabled={!permissions.canEdit}
                            onChange={event => {
                              const normalized = normalizeDisplayDateInput(event.target.value);
                              const parsed = displayDateToIso(normalized);
                              updateCard(card, { publishedAt: parsed.iso || normalized });
                              if (!parsed.error) setError('');
                            }}
                            onBlur={event => {
                              const parsed = displayDateToIso(event.target.value);
                              if (parsed.error) setError(parsed.error);
                              else updateCard(card, { publishedAt: parsed.iso });
                            }}
                            className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2 pr-12 text-sm font-bold text-clinic-text disabled:opacity-60"
                            placeholder="DD/MM/AAAA"
                          />
                          <label htmlFor={datePickerId} className="absolute inset-y-1 right-1 flex w-9 cursor-pointer items-center justify-center rounded-md text-clinic-primary transition hover:bg-clinic-surface" title="Abrir calendário" aria-label="Abrir calendário da Data de publicação">
                            <CalendarDays size={17} />
                            <input
                              id={datePickerId}
                              type="date"
                              value={isSafeIsoDate(card.publishedAt) ? card.publishedAt : ''}
                              disabled={!permissions.canEdit}
                              onChange={event => updateCard(card, { publishedAt: event.target.value })}
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                              aria-label="Selecionar Data de publicação no calendário"
                            />
                          </label>
                        </div>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[11px] font-black text-clinic-text">Link</span>
                        <input type="url" inputMode="url" maxLength={2048} value={card.url} disabled={!permissions.canEdit} onChange={event => updateCard(card, { url: event.target.value })} className={`w-full rounded-lg border bg-clinic-bg px-3 py-2 text-sm text-clinic-text disabled:opacity-60 ${cardHasInvalidLink ? 'border-status-orange-text/60' : 'border-clinic-border'}`} placeholder="https://photos.app.goo.gl/..." />
                        {cardHasInvalidLink && <span className="mt-1 block text-xs font-bold text-status-orange-text">Use um link HTTPS válido de photos.app.goo.gl.</span>}
                      </label>

                      <div className="flex justify-end pt-0.5">
                        <button type="button" onClick={() => void saveNow()} disabled={saving || !permissions.canEdit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-clinic-primary px-4 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          Salvar
                        </button>
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
