import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CLINIC_INFO } from './constants';
import { AppState, Patient, Session, Payment, Reposition, ClinicSettings, Expense, Evolution, PersonalAppointment, ExternalRegistrationForm } from './types';
import { Bell, Calendar, Users, DollarSign, BarChart3, LayoutDashboard, Settings as SettingsIcon, Loader2, BookOpen, ClipboardList, Images, X, ExternalLink, Monitor, MapPin, UserRound, Clock3, Check, CheckCheck, RefreshCw, Archive, Trash2, Mail, MailOpen, Menu } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAlarms } from './lib/useAlarms';
import { cn } from './lib/utils';
import { isPendingExternalRegistrationStatus, sanitizeForFirestore } from './lib/externalRegistration';
import { applyTheme, resolveTheme, storeTheme, type AppTheme } from './lib/theme';
import packageJson from '../package.json';

import { auth, db, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, collection, writeBatch, type WriteBatch, query, where } from 'firebase/firestore';
import ExternalRegistrationPage from './components/ExternalRegistrationPage';
import BrandLogo from './components/Common/BrandLogo';
import AccessPortal from './components/Auth/AccessPortal';
import ResponsiblePortal from './components/Auth/ResponsiblePortal';
import PasswordSecurityPanel from './components/Auth/PasswordSecurityPanel';
import NotificationCenter from './components/Notifications/NotificationCenter';
import {
  clearAccessApiCaches,
  getAccessProfile,
  getProfessionalPortalNotifications,
  manageProfessionalPortalNotifications,
  clearMonitoringSessionId,
} from './lib/accessApi';
import type {
  AccessProfile,
  AccessRequestRole,
  AccessRole,
  ProfessionalNotificationAction,
  ProfessionalNotificationBulkScope,
  ProfessionalPortalNotification,
} from './types/access';
import { ACTIVITY_GALLERY_CHANGED_EVENT } from './lib/activityRecordsApi';
import { useDailyWhatsappOperationalReport } from './lib/useDailyWhatsappOperationalReport';
import SidebarNavigation, { type AppNavigationItem } from './components/Navigation/SidebarNavigation';
import {
  loadNavigationMode,
  loadSidebarCollapsed,
  storeNavigationMode,
  storeSidebarCollapsed,
  type NavigationMode,
} from './lib/navigationPreferences';

const Dashboard = lazy(() => import('./components/Dashboard'));
const Agenda = lazy(() => import('./components/Agenda'));
const PersonalAgenda = lazy(() => import('./components/PersonalAgenda'));
const Patients = lazy(() => import('./components/Patients'));
const Finance = lazy(() => import('./components/Finance'));
const Reports = lazy(() => import('./components/Reports'));
const Settings = lazy(() => import('./components/Settings'));
const PreRegistrations = lazy(() => import('./components/PreRegistrations'));
const ProfessionalGooglePhotosGallery = lazy(() => import('./components/GooglePhotosAlbums/ProfessionalGooglePhotosGallery'));
const MonitoringPanel = lazy(() => import('./components/Monitoring/MonitoringPanel'));

const DEFAULT_SETTINGS: ClinicSettings = {
  name: 'Clinica Integra',
  specialty: 'Atendimento Especializado',
  title: 'Gestão Clínica e Acompanhamento',
  email: 'contato@clinicaintegra.com',
  whatsapp: '(27) 99999-0000',
  address: 'Rua das Flores, 123 - Centro, Vitória - ES',
};

const DEFAULT_STATE: AppState = {
  patients: [],
  sessions: [],
  payments: [],
  repositions: [],
  expenses: [],
  evolutions: [],
  settings: DEFAULT_SETTINGS,
  personalAppointments: [],
  externalRegistrationForms: [],
};

const PROFILE_LABELS: Record<AccessRole, string> = {
  admin: 'Administrador',
  professional: 'Profissional',
  monitoring: 'Monitoramento',
  responsible: 'Responsável',
};

const PROFILE_DESCRIPTIONS: Record<AccessRole, string> = {
  admin: 'Acesso administrativo completo da clínica.',
  professional: 'Agenda, atendentes e gestão clínica profissional.',
  monitoring: 'Painel somente leitura de acompanhamento.',
  responsible: 'Portal do Responsável e materiais autorizados.',
};

function profileIsCurrentlyActive(profileState: NonNullable<AccessProfile['profiles']>[AccessRole] | undefined): boolean {
  if (!profileState || profileState.status !== 'approved') return false;
  if (profileState.suspension?.active === true) return false;
  if (profileState.expiresAt && new Date(profileState.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function getActiveProfileRoles(profile: AccessProfile | null): AccessRole[] {
  if (!profile) return [];
  const roles = Object.entries(profile.profiles || {})
    .filter((entry): entry is [AccessRole, NonNullable<AccessProfile['profiles']>[AccessRole]] => Boolean(entry[1]))
    .filter(([, state]) => profileIsCurrentlyActive(state))
    .map(([role]) => role);
  if (roles.length > 0) return roles;
  return profile.status === 'approved' ? [profile.role] : [];
}

function ProfileChoiceScreen({
  profile,
  onChoose,
  onLogout,
}: {
  profile: AccessProfile;
  onChoose: (role: AccessRole) => void;
  onLogout: () => void;
}) {
  const roles = getActiveProfileRoles(profile);
  return (
    <div className="flex min-h-screen items-center justify-center bg-clinic-bg p-4">
      <section className="w-full max-w-3xl rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic sm:p-7">
        <BrandLogo
          variant="horizontal"
          theme="health-balance"
          name="Fábio Denarde"
          subtitle="Gestão Clínica e Acompanhamento"
          className="mb-6"
        />
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-clinic-primary">Perfil de acesso</p>
        <h1 className="mt-2 text-3xl font-black text-clinic-text">Como deseja entrar?</h1>
        <p className="mt-2 text-sm text-clinic-text-muted">
          Escolha o perfil aprovado que deseja usar nesta sessão.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {roles.map(role => (
            <button
              key={role}
              type="button"
              onClick={() => onChoose(role)}
              className="rounded-xl border border-clinic-border bg-white p-4 text-left shadow-sm transition hover:border-clinic-primary hover:bg-clinic-bg focus:outline-none focus:ring-2 focus:ring-clinic-primary/35"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-status-green-bg text-status-green-text">
                {role === 'monitoring' ? <Monitor size={21} /> : <UserRound size={21} />}
              </span>
              <span className="mt-4 block text-lg font-black text-clinic-text">
                Entrar {role === 'monitoring' ? 'no' : 'como'} {PROFILE_LABELS[role]}
              </span>
              <span className="mt-1 block text-sm text-clinic-text-muted">{PROFILE_DESCRIPTIONS[role]}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onLogout} className="mt-6 text-sm font-bold text-clinic-text-muted hover:text-clinic-primary">
          Sair desta conta
        </button>
      </section>
    </div>
  );
}

const APP_VERSION = `v${packageJson.version}`;
const NOTIFICATION_MANUAL_MIN_INTERVAL_MS = 5 * 1000;
type PortalNotification = ProfessionalPortalNotification;

function mergePortalNotifications(
  current: PortalNotification[],
  incoming: PortalNotification[],
): PortalNotification[] {
  const byId = new Map(current.map(notification => [notification.id, notification]));
  for (const notification of incoming) byId.set(notification.id, notification);
  return [...byId.values()]
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, 500);
}

function formatPortalNotificationDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatAuditDuration(value?: number): string {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}min ${seconds}s`;
  if (minutes > 0) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

export default function App() {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const directAccessRole: AccessRequestRole | null = normalizedPath === '/responsavel'
    ? 'responsible'
    : normalizedPath === '/profissional'
      ? 'professional'
      : normalizedPath === '/monitoramento'
        ? 'monitoring'
        : null;
  const publicRegistrationMatch = window.location.pathname.match(/^\/pre-cadastro\/([a-f0-9]{64})\/?$/i);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessProfile, setAccessProfile] = useState<AccessProfile | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [accessRetryKey, setAccessRetryKey] = useState(0);
  const [selectedAccessRole, setSelectedAccessRole] = useState<AccessRole | null>(directAccessRole);
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [dataLoading, setDataLoading] = useState(false);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [navigationMode, setNavigationMode] = useState<NavigationMode>(() => loadNavigationMode());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationHasMore, setNotificationHasMore] = useState(false);
  const [selectedPortalNotification, setSelectedPortalNotification] = useState<PortalNotification | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedPatientSubTab, setSelectedPatientSubTab] = useState<string | null>(null);
  const [selectedGalleryPatientId, setSelectedGalleryPatientId] = useState<string | null>(null);
  const [selectedGallerySessionId, setSelectedGallerySessionId] = useState<string | null>(null);
  const [galleryNavigationKey, setGalleryNavigationKey] = useState(0);
  const loadedCollectionsRef = useRef<Set<string>>(new Set());
  const notificationCursorRef = useRef<string | null>(null);
  const notificationOldestCursorRef = useRef<string | null>(null);
  const notificationLastLoadedAtRef = useRef(0);
  const notificationInFlightRef = useRef<Promise<boolean> | null>(null);
  const forceAccessTokenRefreshRef = useRef(false);

  const { activeAlarmId, activeAlarmLabel, stopAlarm } = useAlarms(state.personalAppointments || []);
  const whatsappOperationalReportState = useDailyWhatsappOperationalReport(
    !publicRegistrationMatch
      && accessProfile?.status === 'approved'
      && accessProfile.role === 'admin',
  );

  if (publicRegistrationMatch) {
    return <ExternalRegistrationPage token={publicRegistrationMatch[1]} />;
  }

  const navigateToPatient = (id: string, subTab: string = 'dados') => {
    setSelectedPatientSubTab(subTab);
    setSelectedPatientId(id);
    setActiveTab('atendentes');
  };

  const openActivityGallery = (patientId: string | null = null, sessionId: string | null = null) => {
    setSelectedGalleryPatientId(patientId);
    setSelectedGallerySessionId(sessionId);
    setGalleryNavigationKey(current => current + 1);
    setActiveTab('galeria-atividades');
    setMobileSidebarOpen(false);
  };

  const navigateToPatientGallery = (id: string, sessionId?: string) => {
    openActivityGallery(id, sessionId || null);
  };

  const changeNavigationMode = (mode: NavigationMode) => {
    setNavigationMode(mode);
    storeNavigationMode(mode);
    setMobileSidebarOpen(false);
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(current => {
      const next = !current;
      storeSidebarCollapsed(next);
      return next;
    });
  };

  const selectNavigationItem = (id: string) => {
    if (id === 'galeria-atividades') {
      setSelectedGalleryPatientId(null);
      setSelectedGallerySessionId(null);
      setGalleryNavigationKey(current => current + 1);
    }
    setActiveTab(id);
    setMobileSidebarOpen(false);
  };

  const navigateToProfileHome = () => {
    const role = accessProfile?.role;
    const target = role === 'admin' || role === 'professional' || role === 'monitoring'
      ? 'dashboard'
      : 'dashboard';
    selectNavigationItem(target);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setAccessProfile(null);
        setSelectedAccessRole(directAccessRole);
        setAccessLoading(false);
        setAccessError('');
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const forceRefreshToken = forceAccessTokenRefreshRef.current;
    forceAccessTokenRefreshRef.current = false;

    setAccessLoading(true);
    setAccessError('');
    void getAccessProfile(user, { forceRefreshToken, activeRole: selectedAccessRole })
      .then(profile => {
        if (!cancelled) setAccessProfile(profile);
      })
      .catch(error => {
        if (!cancelled) {
          setAccessProfile(null);
          setAccessError(error instanceof Error ? error.message : 'Não foi possível validar seu acesso.');
        }
      })
      .finally(() => {
        if (!cancelled) setAccessLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessRetryKey, selectedAccessRole, user]);

  const handleRetryAccessProfile = useCallback(() => {
    forceAccessTokenRefreshRef.current = true;
    setAccessError('');
    setAccessRetryKey(current => current + 1);
  }, []);

  const handleAccessPortalLogout = useCallback(async () => {
    if (accessProfile?.role === 'monitoring') {
      clearMonitoringSessionId(user || undefined);
    }
    await logout();
    forceAccessTokenRefreshRef.current = false;
    setUser(null);
    setAccessProfile(null);
    setSelectedAccessRole(directAccessRole);
    setAccessLoading(false);
    setAccessError('');
  }, [accessProfile?.role, directAccessRole, user]);

  const resetSessionScopedData = useCallback(() => {
    clearAccessApiCaches();
    setState(DEFAULT_STATE);
    setNotifications([]);
    setNotificationsOpen(false);
    setNotificationCenterOpen(false);
    setNotificationHasMore(false);
    setSelectedPortalNotification(null);
    setSelectedPatientId(null);
    setSelectedPatientSubTab(null);
    setSelectedGalleryPatientId(null);
    setSelectedGallerySessionId(null);
    setActiveTab('dashboard');
    loadedCollectionsRef.current.clear();
    notificationCursorRef.current = null;
    notificationOldestCursorRef.current = null;
    notificationInFlightRef.current = null;
  }, []);

  const chooseAccessRole = useCallback((role: AccessRole) => {
    resetSessionScopedData();
    setSelectedAccessRole(role);
    setAccessProfile(null);
    setAccessLoading(true);
    setAccessRetryKey(current => current + 1);
  }, [resetSessionScopedData]);

  const switchAccessRole = useCallback(() => {
    if (directAccessRole) return;
    resetSessionScopedData();
    setSelectedAccessRole(null);
    setAccessProfile(current => current ? { ...current } : current);
  }, [directAccessRole, resetSessionScopedData]);

  const canAccessInternalSystem =
    accessProfile?.status === 'approved'
    && (accessProfile.role === 'admin' || accessProfile.role === 'professional');
  const canManagePortalNotifications =
    accessProfile?.status === 'approved'
    && accessProfile.role === 'admin';
  const canAccessResponsiblePortal =
    accessProfile?.status === 'approved'
    && accessProfile.role === 'responsible';
  const canAccessMonitoringPanel =
    accessProfile?.status === 'approved'
    && accessProfile.role === 'monitoring';

  const refreshPortalNotifications = useCallback(async (options?: {
    initial?: boolean;
    force?: boolean;
  }): Promise<boolean> => {
    if (!user || !canManagePortalNotifications) return false;
    if (document.visibilityState === 'hidden' && !options?.force) return false;

    const now = Date.now();
    if (!options?.initial && now - notificationLastLoadedAtRef.current < NOTIFICATION_MANUAL_MIN_INTERVAL_MS) {
      return true;
    }
    if (notificationInFlightRef.current) return notificationInFlightRef.current;

    const requestPromise = (async () => {
      setNotificationLoading(true);
      try {
        const result = await getProfessionalPortalNotifications({
          updatedAfter: options?.initial ? null : notificationCursorRef.current,
          limit: 20,
        });
        setNotifications(current => (
          options?.initial
            ? mergePortalNotifications([], result.notifications)
            : mergePortalNotifications(current, result.notifications)
        ));
        if (result.cursor) notificationCursorRef.current = result.cursor;
        if (options?.initial) {
          notificationOldestCursorRef.current = result.nextPageCursor;
          setNotificationHasMore(result.hasMore);
        }
        notificationLastLoadedAtRef.current = Date.now();
        return true;
      } catch (error) {
        notificationLastLoadedAtRef.current = Date.now();
        console.error('Falha ao carregar notificações do Portal do Responsável:', error);
        return false;
      } finally {
        setNotificationLoading(false);
        notificationInFlightRef.current = null;
      }
    })();

    notificationInFlightRef.current = requestPromise;
    return requestPromise;
  }, [canManagePortalNotifications, user]);

  const loadOlderPortalNotifications = useCallback(async (): Promise<void> => {
    if (!user || !canManagePortalNotifications || !notificationHasMore || notificationLoading) return;
    setNotificationLoading(true);
    try {
      const result = await getProfessionalPortalNotifications({
        before: notificationOldestCursorRef.current,
        limit: 20,
      });
      setNotifications(current => mergePortalNotifications(current, result.notifications));
      notificationOldestCursorRef.current = result.nextPageCursor;
      setNotificationHasMore(result.hasMore);
    } catch (error) {
      console.error('Falha ao carregar notificações anteriores:', error);
    } finally {
      setNotificationLoading(false);
    }
  }, [canManagePortalNotifications, notificationHasMore, notificationLoading, user]);


  useEffect(() => {
    if (!user || !canManagePortalNotifications) {
      setNotifications([]);
      setNotificationsOpen(false);
      setSelectedPortalNotification(null);
      notificationCursorRef.current = null;
      notificationOldestCursorRef.current = null;
      notificationLastLoadedAtRef.current = 0;
      setNotificationHasMore(false);
      setNotificationCenterOpen(false);
      return;
    }

    void refreshPortalNotifications({ initial: true, force: true });
  }, [canManagePortalNotifications, refreshPortalNotifications, user]);


  useEffect(() => {
    if (!user || !canAccessInternalSystem) return;
    
    setDataLoading(true);
    loadedCollectionsRef.current.clear();
    
    // Subscribe to all collections
    const unsubscribers: (() => void)[] = [];
    
    const userDocRef = doc(db, 'users', user.uid);
    let hasReceivedAuthoritativeSessionsSnapshot = false;
    const markCollectionLoaded = (collectionName: string) => {
      loadedCollectionsRef.current.add(collectionName);
    };
    
    // settings
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'settings'), (snapshot) => {
        let settings = DEFAULT_SETTINGS;
        snapshot.forEach(doc => {
          if (doc.id === 'config') {
            settings = { ...DEFAULT_SETTINGS, ...doc.data() } as ClinicSettings;
          }
        });
        const visualTheme = resolveTheme(settings.visualTheme);
        applyTheme(visualTheme);
        storeTheme(visualTheme);
        markCollectionLoaded('settings');
        setState(prev => ({ ...prev, settings: { ...settings, visualTheme } }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'settings'))
    );
    
    // patients
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'patients'), (snapshot) => {
        const patients = snapshot.docs.map(doc => doc.data() as Patient);
        markCollectionLoaded('patients');
        setState(prev => ({ ...prev, patients }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'patients'))
    );
    
    // sessions
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'sessions'), { includeMetadataChanges: true }, (snapshot) => {
        const sessions = snapshot.docs.map(doc => doc.data() as Session);
        markCollectionLoaded('sessions');
        setState(prev => ({ ...prev, sessions }));

        if (snapshot.metadata.fromCache) return;
        if (!hasReceivedAuthoritativeSessionsSnapshot) {
          hasReceivedAuthoritativeSessionsSnapshot = true;
          return;
        }
        if (snapshot.docChanges().length > 0 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(ACTIVITY_GALLERY_CHANGED_EVENT, {
            detail: { reason: 'sessions-updated' },
          }));
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, 'sessions'))
    );
    
    // payments
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'payments'), (snapshot) => {
        const payments = snapshot.docs.map(doc => doc.data() as Payment);
        markCollectionLoaded('payments');
        setState(prev => ({ ...prev, payments }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'payments'))
    );
    
    // repositions
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'repositions'), (snapshot) => {
        const repositions = snapshot.docs.map(doc => doc.data() as Reposition);
        markCollectionLoaded('repositions');
        setState(prev => ({ ...prev, repositions }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'repositions'))
    );
    
    // expenses
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'expenses'), (snapshot) => {
        const expenses = snapshot.docs.map(doc => doc.data() as Expense);
        markCollectionLoaded('expenses');
        setState(prev => ({ ...prev, expenses }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'expenses'))
    );
    
    // evolutions
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'evolutions'), (snapshot) => {
        const evolutions = snapshot.docs.map(doc => doc.data() as Evolution);
        markCollectionLoaded('evolutions');
        setState(prev => ({ ...prev, evolutions }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'evolutions'))
    );
    
    // agenda_pessoal
    unsubscribers.push(
      onSnapshot(collection(userDocRef, 'agenda_pessoal'), (snapshot) => {
        const personalAppointments = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: data.id,
            date: data.data || '',
            time: data.hora || '',
            type: data.tipo_compromisso || 'Outro',
            durationMinutes: 60,
            notes: data.observacao || '',
            recurrence: data.recorrencia || 'Não repetir',
            alarmEnabled: data.alarme || false,
            alarmSound: data.som_alarme,
            alarmAdvance: data.antecedencia_alarme,
            alarmVolume: data.volume_alarme ?? 80,
            alarmFadeIn: data.fade_in ?? false,
            isDone: data.status === 'concluído'
          } as PersonalAppointment;
        });
        markCollectionLoaded('agenda_pessoal');
        setState(prev => ({ ...prev, personalAppointments }));
        setDataLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'agenda_pessoal');
        setDataLoading(false);
      })
    );

    unsubscribers.push(
      onSnapshot(query(collection(db, 'externalRegistrationForms'), where('ownerUserId', '==', user.uid)), (snapshot) => {
        const externalRegistrationForms = snapshot.docs.map(doc => doc.data() as ExternalRegistrationForm);
        markCollectionLoaded('externalRegistrationForms');
        setState(prev => ({ ...prev, externalRegistrationForms }));
      }, (error) => handleFirestoreError(error, OperationType.GET, 'externalRegistrationForms'))
    );
    
    // Fallback: Se a internet estiver lenta ou o Firebase não responder, destrava após 3s
    const fallbackTimer = setTimeout(() => {
      setDataLoading(false);
    }, 3000);
    
    return () => {
      clearTimeout(fallbackTimer);
      unsubscribers.forEach(unsub => unsub());
    };
  }, [canAccessInternalSystem, user]);

  const updateState = async (newState: Partial<AppState>) => {
    if (!user || !canAccessInternalSystem) return;
    const userDocRef = doc(db, 'users', user.uid);
    const activityGalleryRelevantChange = Boolean(
      newState.settings
      && newState.settings.activityMediaMonitoringStart !== state.settings.activityMediaMonitoringStart
    );
    
    try {
      let batch = writeBatch(db);
      let opCount = 0;

      const commitBatch = async () => {
        if (opCount > 0) {
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        }
      };

      const addOp = async (op: (b: WriteBatch) => void) => {
        op(batch);
        opCount++;
        if (opCount >= 400) {
          await commitBatch();
        }
      };

      const hasMeaningfulChange = <T extends { id: string }>(currentItem: T | undefined, nextItem: T) => {
        if (!currentItem) return true;
        return JSON.stringify(currentItem) !== JSON.stringify(nextItem);
      };

      const syncCollection = async <T extends { id: string }>(
        collectionName: string,
        currentItems: T[],
        nextItems: T[],
        mapToFirestore: (item: T) => unknown = item => item
      ) => {
        if (!loadedCollectionsRef.current.has(collectionName)) {
          throw new Error(`Gravação bloqueada: a coleção "${collectionName}" ainda não concluiu o primeiro carregamento.`);
        }

        const currentMap = new Map(currentItems.map(item => [item.id, item]));
        const nextMap = new Map(nextItems.map(item => [item.id, item]));
        const colRef = collection(userDocRef, collectionName);

        for (const id of currentMap.keys()) {
          if (!nextMap.has(id)) {
            await addOp(b => b.delete(doc(colRef, id)));
          }
        }

        for (const item of nextItems) {
          if (hasMeaningfulChange(currentMap.get(item.id), item)) {
            await addOp(b => b.set(doc(colRef, item.id), mapToFirestore(item)));
          }
        }
      };

      if (newState.settings) {
        if (!loadedCollectionsRef.current.has('settings')) {
          throw new Error('Gravação bloqueada: as configurações ainda não concluíram o primeiro carregamento.');
        }
        await addOp(b => b.set(doc(collection(userDocRef, 'settings'), 'config'), newState.settings!));
      }
      
      if (newState.patients) {
        await syncCollection('patients', state.patients, newState.patients);
      }
      
      if (newState.sessions) {
        await syncCollection('sessions', state.sessions, newState.sessions);
      }
      
      if (newState.payments) {
        await syncCollection('payments', state.payments, newState.payments);
      }
      
      if (newState.repositions) {
        await syncCollection('repositions', state.repositions, newState.repositions);
      }
      
      if (newState.expenses) {
        await syncCollection('expenses', state.expenses, newState.expenses);
      }
      
      if (newState.evolutions) {
        await syncCollection('evolutions', state.evolutions, newState.evolutions);
      }

      if (newState.personalAppointments) {
        await syncCollection('agenda_pessoal', state.personalAppointments, newState.personalAppointments, a => ({
            id: a.id,
            data: a.date,
            hora: a.time,
            tipo_compromisso: a.type,
            observacao: a.notes,
            recorrencia: a.recurrence,
            alarme: a.alarmEnabled,
            som_alarme: a.alarmSound || null,
            antecedencia_alarme: a.alarmAdvance || null,
            volume_alarme: a.alarmVolume ?? 80,
            fade_in: a.alarmFadeIn ?? false,
            status: a.isDone ? 'concluído' : 'ativo',
            criado_em: new Date().toISOString()
          }));
      }

      if (newState.externalRegistrationForms) {
        if (!loadedCollectionsRef.current.has('externalRegistrationForms')) {
          throw new Error('Gravação bloqueada: os formulários externos ainda não concluíram o primeiro carregamento.');
        }
        const collectionName = 'externalRegistrationForms';
        const currentItems: ExternalRegistrationForm[] = state.externalRegistrationForms || [];
        const nextItems: ExternalRegistrationForm[] = newState.externalRegistrationForms;
        const currentMap = new Map<string, ExternalRegistrationForm>(currentItems.map(item => [item.id, item]));
        const nextMap = new Map<string, ExternalRegistrationForm>(nextItems.map(item => [item.id, item]));
        const colRef = collection(db, collectionName);

        for (const id of currentMap.keys()) {
          if (!nextMap.has(id)) {
            await addOp(b => b.delete(doc(colRef, id)));
          }
        }

        for (const item of nextItems) {
          if (hasMeaningfulChange(currentMap.get(item.id), item)) {
            await addOp(b => b.set(doc(colRef, item.id), sanitizeForFirestore(item)));
          }
        }
      }

      await commitBatch();

      setState(previousState => ({ ...previousState, ...newState }));

      if (activityGalleryRelevantChange && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ACTIVITY_GALLERY_CHANGED_EVENT, {
          detail: { reason: 'clinic-data-updated' },
        }));
      }

    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users/' + user.uid);
    }
  };

  const updateVisualTheme = async (visualTheme: AppTheme): Promise<boolean> => {
    applyTheme(visualTheme);
    storeTheme(visualTheme);
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, visualTheme },
    }));

    if (!user || !canAccessInternalSystem || !loadedCollectionsRef.current.has('settings')) return false;

    try {
      const batch = writeBatch(db);
      batch.set(
        doc(collection(doc(db, 'users', user.uid), 'settings'), 'config'),
        { visualTheme },
        { merge: true },
      );
      await batch.commit();
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/settings/config`);
      return false;
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-clinic-bg">
        <Loader2 className="w-12 h-12 text-clinic-primary animate-spin" />
      </div>
    );
  }

  const activeProfileRoles = getActiveProfileRoles(accessProfile);
  const hasMultipleActiveProfiles = activeProfileRoles.length > 1;
  const handlePasswordProfileUpdated = (profile: AccessProfile) => {
    setAccessProfile(profile);
    setAccessError('');
    setAccessLoading(false);
  };

  if (user && accessProfile?.mustChangePassword === true) {
    return (
      <PasswordSecurityPanel
        user={user}
        profile={accessProfile}
        required
        onProfileUpdated={handlePasswordProfileUpdated}
        onLogout={handleAccessPortalLogout}
      />
    );
  }

  if (user && !directAccessRole && accessProfile && activeProfileRoles.length > 0 && !selectedAccessRole) {
    return (
      <ProfileChoiceScreen
        profile={accessProfile}
        onChoose={chooseAccessRole}
        onLogout={() => void handleAccessPortalLogout()}
      />
    );
  }

  if (user && canAccessResponsiblePortal) {
    return (
      <>
        {!directAccessRole && hasMultipleActiveProfiles && (
          <button
            type="button"
            onClick={switchAccessRole}
            className="fixed bottom-4 right-4 z-[220] rounded-xl bg-status-green-text px-4 py-3 text-xs font-black uppercase text-white shadow-lg"
          >
            Trocar perfil
          </button>
        )}
        <ResponsiblePortal user={user} />
        {accessProfile && (
          <PasswordSecurityPanel
            user={user}
            profile={accessProfile}
            onProfileUpdated={handlePasswordProfileUpdated}
            onLogout={handleAccessPortalLogout}
          />
        )}
      </>
    );
  }

  if (user && canAccessMonitoringPanel) {
    return (
      <>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-clinic-bg"><Loader2 className="h-10 w-10 animate-spin text-clinic-primary" /></div>}>
          <MonitoringPanel onLogout={() => void handleAccessPortalLogout()} onSwitchProfile={!directAccessRole && hasMultipleActiveProfiles ? switchAccessRole : undefined} />
        </Suspense>
        {accessProfile && (
          <PasswordSecurityPanel
            user={user}
            profile={accessProfile}
            onProfileUpdated={handlePasswordProfileUpdated}
            onLogout={handleAccessPortalLogout}
          />
        )}
      </>
    );
  }

  if (!user || !canAccessInternalSystem) {
    return (
      <AccessPortal
        user={user}
        profile={accessProfile}
        profileLoading={accessLoading}
        profileError={accessError}
        selectedLoginRole={selectedAccessRole && selectedAccessRole !== 'admin' ? selectedAccessRole as AccessRequestRole : null}
        accessRouteRole={directAccessRole}
        onSelectedLoginRoleChange={role => setSelectedAccessRole(directAccessRole || role)}
        onAccessRequestSubmitted={profile => {
          setAccessProfile(profile);
          setAccessLoading(false);
          setAccessError('');
        }}
        onRetryProfile={handleRetryAccessProfile}
        onChooseAnotherRole={directAccessRole ? undefined : switchAccessRole}
        onLogout={handleAccessPortalLogout}
      />
    );
  }

  const pendingExternalForms = (state.externalRegistrationForms || []).filter(form =>
    isPendingExternalRegistrationStatus(form.status)
  ).length;
  const activePortalNotifications = notifications.filter(notification => !notification.archived);
  const unreadPortalNotifications = activePortalNotifications.filter(notification => !notification.read);
  const pendingPortalNotifications = activePortalNotifications.filter(notification => notification.pendingAction && !notification.completed);
  const notificationAttentionCount = activePortalNotifications.filter(notification => (
    !notification.read || (notification.pendingAction && !notification.completed)
  )).length;

  const togglePortalNotifications = async () => {
    const opening = !notificationsOpen;
    setNotificationsOpen(opening);
    if (opening) await refreshPortalNotifications({ force: true });
  };

  const openPortalNotification = (notification: PortalNotification) => {
    setNotificationsOpen(false);
    setSelectedPortalNotification(notification);
  };

  const updateNotificationStateLocally = (
    notificationIds: string[],
    operation: ProfessionalNotificationAction,
  ) => {
    const idSet = new Set(notificationIds);
    setNotifications(current => current
      .filter(item => !(operation === 'delete' && idSet.has(item.id)))
      .map(item => {
        if (!idSet.has(item.id)) return item;
        if (operation === 'mark_read') return { ...item, read: true, readAt: new Date().toISOString() };
        if (operation === 'mark_unread') return { ...item, read: false, readAt: null };
        if (operation === 'complete') return { ...item, read: true, pendingAction: false, completed: true, status: 'completed', completedAt: new Date().toISOString() };
        if (operation === 'archive') return { ...item, read: true, archived: true, status: 'archived', archivedAt: new Date().toISOString() };
        if (operation === 'ignore') return { ...item, read: true, ignored: true, archived: true, status: 'ignored', archivedAt: new Date().toISOString() };
        return item;
      }));
    setSelectedPortalNotification(current => {
      if (!current || !idSet.has(current.id)) return current;
      if (operation === 'delete') return null;
      if (operation === 'mark_read') return { ...current, read: true, readAt: new Date().toISOString() };
      if (operation === 'mark_unread') return { ...current, read: false, readAt: null };
      if (operation === 'complete') return { ...current, read: true, pendingAction: false, completed: true, status: 'completed', completedAt: new Date().toISOString() };
      if (operation === 'archive') return { ...current, read: true, archived: true, status: 'archived', archivedAt: new Date().toISOString() };
      if (operation === 'ignore') return { ...current, read: true, ignored: true, archived: true, status: 'ignored', archivedAt: new Date().toISOString() };
      return current;
    });
  };

  const manageNotifications = async (
    notificationIds: string[],
    operation: ProfessionalNotificationAction,
  ): Promise<void> => {
    if (notificationIds.length === 0) return;
    try {
      const result = await manageProfessionalPortalNotifications({ operation, notificationIds });
      updateNotificationStateLocally(
        operation === 'delete' ? result.deletedIds : result.affectedIds,
        operation,
      );
      if (result.skippedIds.length > 0) {
        window.alert('Algumas notificações não puderam receber esta ação porque ainda possuem uma pendência ou precisam ser preservadas no histórico.');
      }
    } catch (error) {
      console.error('Falha ao atualizar a notificação:', error);
      window.alert(error instanceof Error ? error.message : 'Não foi possível atualizar a notificação.');
    }
  };

  const manageQuickNotification = async (
    event: React.MouseEvent<HTMLButtonElement>,
    notification: PortalNotification,
    operation: ProfessionalNotificationAction,
  ): Promise<void> => {
    event.stopPropagation();

    if (operation !== 'delete') {
      await manageNotifications([notification.id], operation);
      return;
    }

    if (notification.protectedFromDeletion || (notification.pendingAction && !notification.completed)) {
      window.alert('Esta notificação precisa ser preservada no histórico e não pode ser excluída.');
      return;
    }

    if (!window.confirm('Excluir definitivamente esta notificação? Esta ação não poderá ser desfeita.')) return;

    try {
      if (!notification.archived) {
        const archiveResult = await manageProfessionalPortalNotifications({
          operation: 'archive',
          notificationIds: [notification.id],
        });
        if (!archiveResult.affectedIds.includes(notification.id)) {
          throw new Error('A notificação não pôde ser arquivada antes da exclusão.');
        }
        updateNotificationStateLocally(archiveResult.affectedIds, 'archive');
      }

      const deleteResult = await manageProfessionalPortalNotifications({
        operation: 'delete',
        notificationIds: [notification.id],
      });
      if (!deleteResult.deletedIds.includes(notification.id)) {
        throw new Error('A notificação não pôde ser excluída.');
      }
      updateNotificationStateLocally(deleteResult.deletedIds, 'delete');
    } catch (error) {
      console.error('Falha ao excluir rapidamente a notificação:', error);
      window.alert(error instanceof Error ? error.message : 'Não foi possível excluir a notificação.');
    }
  };

  const bulkManageNotifications = async (
    scope: ProfessionalNotificationBulkScope,
    operation: ProfessionalNotificationAction,
  ): Promise<void> => {
    try {
      const result = await manageProfessionalPortalNotifications({ operation, scope });
      updateNotificationStateLocally(
        operation === 'delete' ? result.deletedIds : result.affectedIds,
        operation,
      );
      if (result.hasMore) {
        window.alert('Foram processadas as primeiras 100 notificações. Repita a ação para continuar, se necessário.');
      }
    } catch (error) {
      console.error('Falha ao atualizar notificações em lote:', error);
      window.alert(error instanceof Error ? error.message : 'Não foi possível atualizar as notificações selecionadas.');
    }
  };

  const openNotificationCenter = async () => {
    setNotificationsOpen(false);
    setNotificationCenterOpen(true);
    await refreshPortalNotifications({ force: true });
  };

  const navigateFromPortalNotification = (notification: PortalNotification) => {
    if (!notification.patientId) return;
    setSelectedPortalNotification(null);
    setNotificationCenterOpen(false);
    if (notification.navigationTarget === 'patient_gallery') {
      navigateToPatientGallery(notification.patientId);
      return;
    }
    navigateToPatient(notification.patientId, 'dados');
  };

  const tabs: AppNavigationItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ...(accessProfile?.role === 'admin'
      ? [{ id: 'monitoramento', label: 'Visão do Monitoramento', icon: Monitor }]
      : []),
    { id: 'agenda', label: 'Agenda', icon: Calendar },
    { id: 'agenda-pessoal', label: 'Agenda Pessoal', icon: BookOpen },
    { id: 'atendentes', label: 'Atendentes', icon: Users },
    { id: 'galeria-atividades', label: 'Galeria de Atividades', icon: Images },
    { id: 'pre-cadastros', label: 'Pré-cadastros', icon: ClipboardList, badge: pendingExternalForms },
    { id: 'pagamentos', label: 'Pagamentos', icon: DollarSign },
    { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
    { id: 'ajustes', label: 'Ajustes', icon: SettingsIcon },
  ];

  const activeNavigationItem = tabs.find(tab => tab.id === activeTab) || tabs[0];
  const currentDateStr = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="min-h-screen bg-clinic-bg">
      {accessProfile && accessProfile.role !== 'admin' && (
        <PasswordSecurityPanel
          user={user}
          profile={accessProfile}
          onProfileUpdated={handlePasswordProfileUpdated}
          onLogout={handleAccessPortalLogout}
        />
      )}
      {navigationMode === 'sidebar' && (
        <SidebarNavigation
          items={tabs}
          activeId={activeTab}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileSidebarOpen}
          clinicName={state.settings.name}
          clinicSubtitle={state.settings.title}
          theme={state.settings.visualTheme}
          userName={user.displayName}
          userEmail={user.email}
          userPhotoUrl={user.photoURL}
          onSelect={selectNavigationItem}
          onHome={navigateToProfileHome}
          onToggleCollapsed={toggleSidebarCollapsed}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onLogout={logout}
        />
      )}
      <div className={cn(
        'min-h-screen flex flex-col pb-10 transition-[padding] duration-200',
        navigationMode === 'sidebar' && (sidebarCollapsed ? 'lg:pl-[76px]' : 'lg:pl-[320px]'),
      )}>
      <header className={cn(
        'sticky top-0 z-50 flex shrink-0 items-center justify-between bg-clinic-header px-3 py-2 text-white shadow-lg sm:px-5 lg:min-h-[66px] xl:px-7',
        navigationMode === 'top'
          ? 'min-h-[64px] flex-nowrap gap-2 sm:gap-3'
          : 'min-h-[58px] gap-3',
      )}>
        {navigationMode === 'top' ? (
          <>
            <div className="min-w-0 flex-1 md:hidden">
              <button
                type="button"
                onClick={navigateToProfileHome}
                className="max-w-[calc(100vw-116px)] cursor-pointer rounded-xl text-left transition hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:max-w-full"
                aria-label="Ir para a página inicial"
              >
                <BrandLogo
                  variant="horizontal"
                  theme={state.settings.visualTheme}
                  name={state.settings.name}
                  subtitle={state.settings.title}
                  className="max-w-[calc(100vw-116px)] whitespace-nowrap sm:max-w-full"
                />
              </button>
            </div>
            <div className="hidden min-w-0 flex-1 md:block">
              <button
                type="button"
                onClick={navigateToProfileHome}
                className="max-w-full cursor-pointer rounded-xl text-left transition hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                aria-label="Ir para a página inicial"
              >
                <BrandLogo
                  theme={state.settings.visualTheme}
                  name={state.settings.name}
                  subtitle={state.settings.title}
                  className="max-w-full"
                />
              </button>
            </div>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white lg:hidden"
              aria-label="Abrir menu lateral"
            >
              <Menu size={21} />
            </button>
            <div className="min-w-0 flex-1 lg:hidden">
              <button
                type="button"
                onClick={navigateToProfileHome}
                className="block max-w-full rounded-lg text-left transition hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                aria-label="Ir para a página inicial"
              >
                <BrandLogo
                  variant="mobile-header"
                  theme={state.settings.visualTheme}
                  name={state.settings.name}
                  subtitle={state.settings.title}
                  showSubtitle={false}
                  className="max-w-full min-w-0"
                />
              </button>
              <h1 className="mt-0.5 truncate text-[10px] font-black uppercase tracking-[0.12em] text-white/80 sm:text-[11px]">
                {activeNavigationItem.label}
              </h1>
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/65">Gestão Clínica</p>
              <h1 className="truncate text-base font-black sm:text-lg">{activeNavigationItem.label}</h1>
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-4 xl:gap-6">
          <div className="text-right hidden md:block">
            <p className="text-[10px] opacity-70 uppercase font-bold tracking-wider">{currentDateStr}</p>
            <p className="text-xs font-medium">Vila Velha, ES</p>
          </div>
          {navigationMode === 'top' && (
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden flex-col text-right sm:flex">
                <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-bold uppercase tracking-wider opacity-80">{user.displayName}</span>
                {hasMultipleActiveProfiles && (
                  <button onClick={switchAccessRole} className="text-xs font-bold text-clinic-nav-bg transition-colors hover:text-white">Trocar perfil</button>
                )}
                <button onClick={logout} className="text-xs font-bold text-clinic-nav-bg transition-colors hover:text-white">Sair</button>
              </div>
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} alt="User" className="h-9 w-9 rounded-full border-2 border-white/20 shadow-md sm:h-10 sm:w-10" />
            </div>
          )}
          {canManagePortalNotifications && (
          <div className="relative">
            <button
              type="button"
              onClick={() => void togglePortalNotifications()}
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-clinic-primary shadow-md transition-all hover:bg-clinic-primary-hover active:scale-95 sm:h-auto sm:w-auto sm:p-2"
              aria-label="Abrir notificações"
            >
              <Bell size={20} />
              {(notificationAttentionCount + pendingExternalForms) > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full border border-clinic-primary bg-white px-1.5 text-[10px] font-bold text-clinic-primary">
                  {notificationAttentionCount + pendingExternalForms}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 top-12 z-[90] w-[min(94vw,410px)] overflow-hidden rounded-2xl border border-clinic-border bg-white text-clinic-text shadow-2xl">
                <div className="border-b border-clinic-border bg-clinic-bg px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-wide text-clinic-primary">Notificações</p>
                      <p className="mt-1 text-[11px] text-clinic-text-muted">{unreadPortalNotifications.length} não lida(s) • {pendingPortalNotifications.length} pendente(s)</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => void refreshPortalNotifications({ force: true })} disabled={notificationLoading} className="rounded-full bg-white p-2 text-clinic-primary disabled:opacity-50" aria-label="Atualizar notificações"><RefreshCw size={15} className={notificationLoading ? 'animate-spin' : ''} /></button>
                      <button type="button" onClick={() => setNotificationsOpen(false)} className="rounded-full bg-white p-2 text-clinic-text-muted" aria-label="Fechar notificações"><X size={15} /></button>
                    </div>
                  </div>
                  {unreadPortalNotifications.length > 0 && (
                    <button type="button" onClick={() => void bulkManageNotifications('all_unread', 'mark_read')} className="mt-3 flex items-center gap-1 text-[10px] font-black uppercase text-clinic-primary"><CheckCheck size={14} /> Marcar todas como lidas</button>
                  )}
                </div>
                <div className="max-h-96 divide-y divide-clinic-border overflow-auto">
                  {activePortalNotifications.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-clinic-text-muted">Nenhuma notificação ativa.</p>
                  )}
                  {activePortalNotifications.slice(0, 10).map(notification => {
                    const canQuickArchive = !notification.pendingAction || notification.completed;
                    const canQuickDelete = !notification.protectedFromDeletion && canQuickArchive;
                    return (
                      <div
                        key={notification.id}
                        className={`flex items-start gap-2 px-3 py-3 transition hover:bg-clinic-bg ${notification.read ? 'bg-white' : 'bg-status-blue-bg/40'}`}
                      >
                        <button
                          type="button"
                          onClick={() => openPortalNotification(notification)}
                          className="min-w-0 flex-1 text-left"
                          aria-label={`Abrir detalhes: ${notification.title || 'Notificação'}`}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            {notification.pendingAction && !notification.completed && <span className="rounded-full bg-status-orange-bg px-2 py-0.5 text-[9px] font-black uppercase text-status-orange-text">Pendente</span>}
                            {!notification.read && <span className="rounded-full bg-status-blue-bg px-2 py-0.5 text-[9px] font-black uppercase text-status-blue-text">Não lida</span>}
                          </div>
                          <p className="mt-1 text-xs font-black text-clinic-text">{notification.title || 'Atividade no Portal do Responsável'}</p>
                          <p className="mt-1 text-[11px] text-clinic-text-muted">{notification.message}</p>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-clinic-text-faint">
                            <span>{notification.actorRole === 'monitoring' ? 'Monitoramento' : (notification.patientName || 'Atendente')}</span>
                            <span>{formatPortalNotificationDate(notification.updatedAt || notification.createdAt)}</span>
                          </div>
                        </button>

                        <div className="flex shrink-0 flex-col gap-1 sm:flex-row" aria-label="Ações rápidas da notificação">
                          <button
                            type="button"
                            onClick={event => void manageQuickNotification(event, notification, notification.read ? 'mark_unread' : 'mark_read')}
                            className="rounded-lg border border-clinic-border bg-white p-2 text-clinic-primary transition hover:bg-status-blue-bg"
                            title={notification.read ? 'Marcar como não lida' : 'Marcar como lida'}
                            aria-label={notification.read ? 'Marcar como não lida' : 'Marcar como lida'}
                          >
                            {notification.read ? <Mail size={14} /> : <MailOpen size={14} />}
                          </button>

                          {notification.pendingAction && !notification.completed && (
                            <button
                              type="button"
                              onClick={event => void manageQuickNotification(event, notification, 'complete')}
                              className="rounded-lg border border-status-green-text/20 bg-status-green-bg p-2 text-status-green-text transition hover:brightness-95"
                              title="Marcar como concluída"
                              aria-label="Marcar como concluída"
                            >
                              <Check size={14} />
                            </button>
                          )}

                          {canQuickArchive && (
                            <button
                              type="button"
                              onClick={event => void manageQuickNotification(event, notification, 'archive')}
                              className="rounded-lg border border-clinic-border bg-white p-2 text-clinic-text-muted transition hover:bg-clinic-bg"
                              title="Arquivar notificação"
                              aria-label="Arquivar notificação"
                            >
                              <Archive size={14} />
                            </button>
                          )}

                          {canQuickDelete && (
                            <button
                              type="button"
                              onClick={event => void manageQuickNotification(event, notification, 'delete')}
                              className="rounded-lg border border-status-red-text/20 bg-status-red-bg p-2 text-status-red-text transition hover:brightness-95"
                              title="Excluir definitivamente"
                              aria-label="Excluir definitivamente"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-clinic-border bg-clinic-bg px-4 py-3">
                  <button type="button" onClick={() => void openNotificationCenter()} className="w-full rounded-xl bg-clinic-primary px-4 py-2.5 text-xs font-black uppercase text-white">Ver todas</button>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </header>

      {activeAlarmId && (
        <div
          onClick={stopAlarm}
          className="bg-red-600 text-white px-6 py-5 flex items-center justify-between cursor-pointer animate-pulse hover:bg-red-700 transition-colors shadow-lg z-50"
        >
          <div className="flex items-center gap-3">
            <Bell size={28} className="animate-bounce" />
            <div>
              <p className="font-bold text-lg">⏰ ALARME DISPARANDO — Clique para parar</p>
              <p className="text-sm opacity-90">{activeAlarmLabel}</p>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); stopAlarm(); }}
            className="bg-white text-red-600 px-8 py-3 rounded-xl font-black hover:bg-red-50 transition-colors shadow-md text-sm uppercase tracking-widest"
          >
            Parar Alarme
          </button>
        </div>
      )}

      {/* Navigation Menu */}
      {navigationMode === 'top' && (
        <nav className="sticky top-[58px] z-40 shrink-0 border-b border-clinic-border-dark bg-clinic-nav-bg lg:top-[66px]">
          <div className="grid w-full grid-cols-3 gap-px px-1 sm:grid-cols-5 xl:grid-cols-10">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => selectNavigationItem(tab.id)}
                className={`
                  flex min-w-0 items-center justify-center gap-1.5 border-b-4 px-1.5 py-2.5 text-[9px] font-bold uppercase tracking-wide transition-all touch-manipulation sm:px-2 sm:text-[10px] 2xl:text-xs
                  ${activeTab === tab.id
                    ? 'border-clinic-primary bg-clinic-surface text-clinic-header'
                    : 'border-transparent text-clinic-text-muted hover:bg-clinic-bg/60'}
                `}
              >
                <tab.icon size={15} className={cn('shrink-0', activeTab === tab.id ? 'text-clinic-primary' : '')} />
                <span className="min-w-0 truncate leading-none">{tab.label}</span>
                {!!tab.badge && (
                  <span className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[8px] font-black text-white ${tab.badgeTone === 'danger' ? 'bg-status-red-text' : 'bg-status-orange-text'}`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className="app-main flex-1 w-full mx-auto px-3 sm:px-4 lg:px-5 xl:px-6 2xl:px-8 overflow-x-hidden relative">
         {dataLoading && (
           <div className="absolute inset-0 bg-clinic-bg/50 backdrop-blur-sm z-50 flex items-center justify-center rounded-3xl">
             <div className="bg-clinic-surface p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4">
               <Loader2 className="w-8 h-8 text-clinic-primary animate-spin" />
               <span className="text-sm font-bold text-clinic-text">Sincronizando banco de dados...</span>
             </div>
           </div>
         )}
        <Suspense fallback={
          <div className="min-h-[360px] flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-clinic-primary animate-spin" />
          </div>
        }>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              {activeTab === 'dashboard' && (
                <Dashboard
                  state={state}
                  onUpdate={updateState}
                  onNavigateToPatient={navigateToPatient}
                  isPrimaryAdmin={accessProfile?.role === 'admin' && accessProfile.email === 'fdenarde@gmail.com'}
                  canViewWhatsappReport={accessProfile?.role === 'admin'}
                  whatsappReportState={whatsappOperationalReportState}
                  onOpenMonitoringPreview={() => setActiveTab('monitoramento')}
                />
              )}
              {activeTab === 'monitoramento' && (
                <MonitoringPanel
                  adminPreview
                  embedded
                  onExitPreview={() => setActiveTab('dashboard')}
                />
              )}
              {activeTab === 'agenda' && <Agenda state={state} onUpdate={updateState} onNavigateToPatient={navigateToPatient} onNavigateToPatientGallery={navigateToPatientGallery} currentUserName={user.displayName || user.email || 'Usuário'} />}
              {activeTab === 'agenda-pessoal' && <PersonalAgenda state={state} onUpdate={updateState} activeAlarmId={activeAlarmId} activeAlarmLabel={activeAlarmLabel} stopAlarm={stopAlarm} />}
              {activeTab === 'atendentes' && <Patients state={state} onUpdate={updateState} selectedPatientId={selectedPatientId} setSelectedPatientId={setSelectedPatientId} initialPatientSubTab={selectedPatientSubTab} onPatientSubTabConsumed={() => setSelectedPatientSubTab(null)} onNavigateToPatientGallery={navigateToPatientGallery} currentUserName={user.displayName || user.email || 'Usuário'} currentUserId={user.uid} />}
              {activeTab === 'galeria-atividades' && <ProfessionalGooglePhotosGallery key={`gallery-${galleryNavigationKey}`} patients={state.patients} sessions={state.sessions} payments={state.payments} currentUserName={user.displayName || user.email || 'Usuário'} initialPatientId={selectedGalleryPatientId} initialSessionId={selectedGallerySessionId} />}
              {activeTab === 'pre-cadastros' && <PreRegistrations state={state} onUpdate={updateState} currentUserName={user.displayName || user.email || 'Usuário'} onNavigateToPatient={navigateToPatient} />}
              {activeTab === 'pagamentos' && <Finance state={state} onUpdate={updateState} />}
              {activeTab === 'relatorios' && <Reports state={state} onUpdate={updateState} isAdmin={accessProfile?.role === 'admin'} whatsappReportState={whatsappOperationalReportState} />}
              {activeTab === 'ajustes' && <Settings state={state} onUpdate={updateState} onThemeChange={updateVisualTheme} canManageActivityMonitoring={accessProfile?.role === 'admin'} navigationMode={navigationMode} onNavigationModeChange={changeNavigationMode} />}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </main>

      {canManagePortalNotifications && (
        <NotificationCenter
        open={notificationCenterOpen}
        notifications={notifications}
        loading={notificationLoading}
        hasMore={notificationHasMore}
        onClose={() => setNotificationCenterOpen(false)}
        onOpenNotification={openPortalNotification}
        onRefresh={async () => { await refreshPortalNotifications({ force: true }); }}
        onLoadMore={loadOlderPortalNotifications}
        onManage={manageNotifications}
        onBulkManage={bulkManageNotifications}
      />
      )}

      {selectedPortalNotification && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="Detalhes da notificação"
          onClick={() => setSelectedPortalNotification(null)}
        >
          <section
            className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-clinic-border bg-clinic-surface shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-clinic-border bg-clinic-bg px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-clinic-primary">Auditoria detalhada</p>
                <h2 className="mt-1 break-words text-xl font-black text-clinic-text">
                  {selectedPortalNotification.title || 'Atividade no Portal do Responsável'}
                </h2>
                <p className="mt-2 text-sm text-clinic-text-muted">{selectedPortalNotification.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!selectedPortalNotification.read && <span className="rounded-full bg-status-blue-bg px-2.5 py-1 text-[9px] font-black uppercase text-status-blue-text">Não lida</span>}
                  {selectedPortalNotification.pendingAction && !selectedPortalNotification.completed && <span className="rounded-full bg-status-orange-bg px-2.5 py-1 text-[9px] font-black uppercase text-status-orange-text">Pendente de ação</span>}
                  {selectedPortalNotification.completed && <span className="rounded-full bg-status-green-bg px-2.5 py-1 text-[9px] font-black uppercase text-status-green-text">Concluída</span>}
                  {selectedPortalNotification.archived && <span className="rounded-full bg-white px-2.5 py-1 text-[9px] font-black uppercase text-clinic-text-muted">Arquivada</span>}
                </div>

              </div>
              <button
                type="button"
                onClick={() => setSelectedPortalNotification(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-clinic-text-muted shadow-sm transition hover:text-clinic-primary"
                aria-label="Fechar detalhes"
              >
                <X size={20} />
              </button>
            </header>

            <div className="overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-clinic-border bg-clinic-bg p-4">
                  <div className="flex items-center gap-2 text-clinic-primary"><UserRound size={17} /><span className="text-[10px] font-black uppercase tracking-wide">Usuário</span></div>
                  <p className="mt-2 font-black text-clinic-text">{selectedPortalNotification.actorName || selectedPortalNotification.responsibleName || 'Não informado'}</p>
                  <p className="mt-1 break-all text-xs text-clinic-text-muted">{selectedPortalNotification.actorEmail || selectedPortalNotification.responsibleEmail || 'E-mail não informado'}</p>
                  <p className="mt-1 text-[10px] font-black uppercase text-clinic-primary">{selectedPortalNotification.actorRole === 'monitoring' ? 'Monitoramento' : 'Responsável'}</p>
                </div>
                <div className="rounded-2xl border border-clinic-border bg-clinic-bg p-4">
                  <div className="flex items-center gap-2 text-clinic-primary"><Users size={17} /><span className="text-[10px] font-black uppercase tracking-wide">Destino da ação</span></div>
                  <p className="mt-2 font-black text-clinic-text">{selectedPortalNotification.patientName || selectedPortalNotification.actionTarget || 'Ação geral do sistema'}</p>
                  <p className="mt-1 text-xs text-clinic-text-muted">{selectedPortalNotification.actionTarget || 'Ação geral do sistema'}</p>
                </div>
                <div className="rounded-2xl border border-clinic-border bg-clinic-bg p-4">
                  <div className="flex items-center gap-2 text-clinic-primary"><Clock3 size={17} /><span className="text-[10px] font-black uppercase tracking-wide">Quando aconteceu</span></div>
                  <p className="mt-2 font-black text-clinic-text">{formatPortalNotificationDate(selectedPortalNotification.updatedAt || selectedPortalNotification.createdAt) || 'Horário não informado'}</p>
                </div>
                <div className="rounded-2xl border border-clinic-border bg-clinic-bg p-4">
                  <div className="flex items-center gap-2 text-clinic-primary"><MapPin size={17} /><span className="text-[10px] font-black uppercase tracking-wide">Local exato no portal</span></div>
                  <p className="mt-2 text-sm font-bold text-clinic-text">{selectedPortalNotification.actionLocation || 'Local não informado'}</p>
                </div>
              </div>

              <div className="mt-5">
                <h3 className="text-sm font-black text-clinic-text">{selectedPortalNotification.type === 'patient_profile_update' ? 'Comparação visual do que foi alterado' : 'Detalhes completos da ação'}</h3>
                <div className="mt-3 space-y-3">
                  {selectedPortalNotification.details.length === 0 && (
                    <p className="rounded-2xl border border-clinic-border bg-clinic-bg p-4 text-sm text-clinic-text-muted">
                      Esta é uma notificação antiga, criada antes da auditoria detalhada. Novas ações mostrarão todos os dados disponíveis.
                    </p>
                  )}
                  {selectedPortalNotification.details.map((detail, index) => (
                    <article key={`${detail.label}-${index}`} className="rounded-2xl border border-clinic-border bg-white p-4 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">{detail.label}</p>
                      {(detail.previousValue !== undefined || detail.newValue !== undefined) ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl bg-status-red-bg/55 p-3">
                            <p className="text-[10px] font-black uppercase tracking-wide text-status-red-text">Antes</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-clinic-text">{detail.previousValue || 'Não informado'}</p>
                          </div>
                          <div className="rounded-xl bg-status-green-bg p-3">
                            <p className="text-[10px] font-black uppercase tracking-wide text-status-green-text">Depois</p>
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-clinic-text">{detail.newValue || 'Não informado'}</p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold text-clinic-text">{detail.value || 'Não informado'}</p>
                      )}
                    </article>
                  ))}
                </div>
              </div>

              {selectedPortalNotification.clientContext && (
                <div className="mt-5 rounded-2xl border border-clinic-border bg-clinic-bg p-4">
                  <div className="flex items-center gap-2 text-clinic-primary"><Monitor size={17} /><span className="text-[10px] font-black uppercase tracking-wide">Dispositivo utilizado</span></div>
                  <div className="mt-3 grid gap-2 text-xs text-clinic-text-muted sm:grid-cols-2">
                    <p><strong className="text-clinic-text">Tipo:</strong> {selectedPortalNotification.clientContext.deviceType || 'Não informado'}</p>
                    <p><strong className="text-clinic-text">Navegador:</strong> {selectedPortalNotification.clientContext.browser || 'Não informado'}</p>
                    <p><strong className="text-clinic-text">Sistema:</strong> {selectedPortalNotification.clientContext.platform || 'Não informado'}</p>
                    <p><strong className="text-clinic-text">Tela:</strong> {selectedPortalNotification.clientContext.viewport || 'Não informado'}</p>
                  </div>
                </div>
              )}
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-clinic-border bg-clinic-bg px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {!selectedPortalNotification.read && (
                <button type="button" onClick={() => void manageNotifications([selectedPortalNotification.id], 'mark_read')} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase text-clinic-primary">Marcar como lida</button>
              )}
              {selectedPortalNotification.pendingAction && !selectedPortalNotification.completed && (
                <button type="button" onClick={() => void manageNotifications([selectedPortalNotification.id], 'complete')} className="rounded-xl bg-status-green-bg px-4 py-3 text-xs font-black uppercase text-status-green-text">Marcar como concluída</button>
              )}
              {(!selectedPortalNotification.pendingAction || selectedPortalNotification.completed) && !selectedPortalNotification.archived && (
                <button type="button" onClick={() => void manageNotifications([selectedPortalNotification.id], 'archive')} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase text-clinic-text-muted">Arquivar</button>
              )}
              {(!selectedPortalNotification.pendingAction || selectedPortalNotification.completed) && !selectedPortalNotification.archived && (
                <button type="button" onClick={() => void manageNotifications([selectedPortalNotification.id], 'ignore')} className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase text-clinic-text-muted">Ignorar</button>
              )}
              {selectedPortalNotification.archived && !selectedPortalNotification.protectedFromDeletion && (
                <button type="button" onClick={() => { if (window.confirm('Excluir definitivamente esta notificação?')) void manageNotifications([selectedPortalNotification.id], 'delete'); }} className="rounded-xl bg-status-red-bg px-4 py-3 text-xs font-black uppercase text-status-red-text">Excluir</button>
              )}
              <button
                type="button"
                onClick={() => setSelectedPortalNotification(null)}
                className="rounded-xl border border-clinic-border bg-white px-4 py-3 text-xs font-black uppercase text-clinic-text-muted"
              >
                Fechar
              </button>
              {selectedPortalNotification.patientId && selectedPortalNotification.navigationTarget !== 'none' && (
                <button
                  type="button"
                  onClick={() => navigateFromPortalNotification(selectedPortalNotification)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-5 py-3 text-xs font-black uppercase text-white"
                >
                  <ExternalLink size={16} />
                  {selectedPortalNotification.navigationTarget === 'patient_gallery'
                    ? 'Abrir Galeria de Atividades'
                    : selectedPortalNotification.navigationTarget === 'patient_documents'
                      ? 'Abrir documentos do atendente'
                      : 'Abrir cadastro do atendente'}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {/* Toast Notification Container placeholder */}
      <div id="toast-container" className="pointer-events-none fixed bottom-24 left-4 right-4 z-[100] flex flex-col items-end gap-2 sm:bottom-6 sm:left-auto sm:right-6" aria-label="Notificações do sistema"></div>

      <footer className="p-4 flex flex-col md:flex-row justify-between items-center border-t border-clinic-border shrink-0 text-[10px] text-clinic-text-faint bg-clinic-surface uppercase tracking-wider font-bold gap-4 mt-auto">
        {state.settings.customFooter ? (
          <div className="w-full text-center whitespace-pre-line">{state.settings.customFooter}</div>
        ) : (
          <>
            <div className="flex flex-wrap justify-center gap-6">
              <span>Email: {state.settings.email}</span>
              <span>Tel: {state.settings.whatsapp || '(27) 99999-0000'}</span>
              <span>End: {state.settings.address}</span>
            </div>
            <div className="text-center md:text-right">
              {state.settings.name} Gestão Clínica {APP_VERSION} • 2026
            </div>
          </>
        )}
      </footer>
      </div>
    </div>
  );
}
