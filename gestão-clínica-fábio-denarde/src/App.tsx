import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CLINIC_INFO } from './constants';
import { AppState, Patient, Session, Payment, Reposition, ClinicSettings, Expense, Evolution, PersonalAppointment, ExternalRegistrationForm } from './types';
import { Bell, Calendar, Users, DollarSign, BarChart3, LayoutDashboard, Settings as SettingsIcon, LogIn, Loader2, BookOpen, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAlarms } from './lib/useAlarms';
import { cn } from './lib/utils';
import { isPendingExternalRegistrationStatus, sanitizeForFirestore } from './lib/externalRegistration';
import { applyTheme, resolveTheme, storeTheme, type AppTheme } from './lib/theme';
import packageJson from '../package.json';

import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, collection, writeBatch, type WriteBatch, query, where } from 'firebase/firestore';
import ExternalRegistrationPage from './components/ExternalRegistrationPage';
import BrandLogo from './components/Common/BrandLogo';

const Dashboard = lazy(() => import('./components/Dashboard'));
const Agenda = lazy(() => import('./components/Agenda'));
const PersonalAgenda = lazy(() => import('./components/PersonalAgenda'));
const Patients = lazy(() => import('./components/Patients'));
const Finance = lazy(() => import('./components/Finance'));
const Reports = lazy(() => import('./components/Reports'));
const Settings = lazy(() => import('./components/Settings'));
const PreRegistrations = lazy(() => import('./components/PreRegistrations'));

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

const APP_VERSION = `v${packageJson.version}`;

export default function App() {
  const publicRegistrationMatch = window.location.pathname.match(/^\/pre-cadastro\/([a-f0-9]{64})\/?$/i);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [dataLoading, setDataLoading] = useState(false);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [notifications, setNotifications] = useState<string[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const loadedCollectionsRef = useRef<Set<string>>(new Set());

  const { activeAlarmId, activeAlarmLabel, stopAlarm } = useAlarms(state.personalAppointments || []);

  if (publicRegistrationMatch) {
    return <ExternalRegistrationPage token={publicRegistrationMatch[1]} />;
  }

  const navigateToPatient = (id: string) => {
    setSelectedPatientId(id);
    setActiveTab('atendentes');
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);


  useEffect(() => {
    if (!user) return;
    
    setDataLoading(true);
    loadedCollectionsRef.current.clear();
    
    // Subscribe to all collections
    const unsubscribers: (() => void)[] = [];
    
    const userDocRef = doc(db, 'users', user.uid);
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
      onSnapshot(collection(userDocRef, 'sessions'), (snapshot) => {
        const sessions = snapshot.docs.map(doc => doc.data() as Session);
        markCollectionLoaded('sessions');
        setState(prev => ({ ...prev, sessions }));
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
  }, [user]);

  const updateState = async (newState: Partial<AppState>) => {
    if (!user) return;
    const userDocRef = doc(db, 'users', user.uid);
    
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

    if (!user || !loadedCollectionsRef.current.has('settings')) return false;

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

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-clinic-bg p-4 relative overflow-hidden">
        <div className="absolute w-[600px] h-[600px] bg-clinic-primary opacity-5 rounded-full blur-3xl -top-20 -left-20 pointer-events-none"></div>
        <div className="absolute w-[400px] h-[400px] bg-clinic-text-faint/10 rounded-full blur-3xl bottom-0 -right-20 pointer-events-none"></div>

        <div className="bg-clinic-surface p-12 rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] border border-clinic-border max-w-sm w-full text-center relative z-10 flex flex-col items-center">
          <div className="bg-clinic-bg p-4 rounded-2xl shadow-sm mb-6 border border-clinic-border">
            <Users size={32} className="text-clinic-primary" />
          </div>
          <h1 className="text-3xl font-bold text-clinic-text mb-2 tracking-tight">Gestão Clínica</h1>
          <p className="text-sm text-clinic-text-muted mb-8 px-4 font-medium leading-relaxed">
            Acesse o sistema com sua conta do Google para visualizar seus pacientes, agendas e relatórios.
          </p>
          <button 
            onClick={loginWithGoogle}
            className="bg-clinic-primary text-white w-full py-3.5 rounded-xl font-bold uppercase tracking-wider flex items-center justify-center gap-3 transition-colors hover:bg-clinic-primary-hover shadow-md hover:shadow-lg active:scale-95"
          >
            <LogIn size={20} />
            Entrar com Google
          </button>
        </div>
      </div>
    );
  }

  const pendingExternalForms = (state.externalRegistrationForms || []).filter(form =>
    isPendingExternalRegistrationStatus(form.status)
  ).length;

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'agenda', label: 'Agenda', icon: Calendar },
    { id: 'agenda-pessoal', label: 'Agenda Pessoal', icon: BookOpen },
    { id: 'atendentes', label: 'Atendentes', icon: Users },
    { id: 'pre-cadastros', label: 'Pré-cadastros', icon: ClipboardList, badge: pendingExternalForms },
    { id: 'pagamentos', label: 'Pagamentos', icon: DollarSign },
    { id: 'relatorios', label: 'Relatórios', icon: BarChart3 },
    { id: 'ajustes', label: 'Ajustes', icon: SettingsIcon },
  ];

  const currentDateStr = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR });

  return (
    <div className="min-h-screen flex flex-col pb-10">
      <header className="bg-clinic-header text-white px-4 sm:px-6 xl:px-8 2xl:px-10 py-1.5 md:py-2 lg:py-2 flex min-h-[56px] flex-col md:min-h-[64px] md:flex-row lg:min-h-[70px] xl:min-h-[74px] gap-2 md:gap-2.5 justify-between items-center shadow-lg shrink-0">
        <div className="md:hidden">
          <BrandLogo variant="compact" theme={state.settings.visualTheme} className="shrink-0" />
        </div>
        <div className="hidden md:block">
          <BrandLogo theme={state.settings.visualTheme} className="shrink-0" />
        </div>
        <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 sm:gap-4 xl:gap-6">
          <div className="text-right hidden md:block">
            <p className="text-[10px] opacity-70 uppercase font-bold tracking-wider">{currentDateStr}</p>
            <p className="text-xs font-medium">Vila Velha, ES</p>
          </div>
          <div className="flex items-center gap-3">
             <div className="flex flex-col text-right hidden sm:flex">
               <span className="text-[10px] uppercase tracking-wider opacity-80 font-bold whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px]">{user.displayName}</span>
               <button onClick={logout} className="text-xs text-clinic-nav-bg hover:text-white font-bold transition-colors">Sair</button>
             </div>
             <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} alt="User" className="w-10 h-10 rounded-full border-2 border-white/20 shadow-md" />
           </div>
          <div className="relative bg-clinic-primary p-2 rounded-full cursor-pointer hover:bg-clinic-primary-hover shadow-md transition-all active:scale-95">
            <Bell size={20} />
            {(notifications.length + pendingExternalForms) > 0 && (
              <span className="absolute -top-1 -right-1 bg-white text-clinic-primary text-[10px] font-bold px-1.5 rounded-full border border-clinic-primary">
                {notifications.length + pendingExternalForms}
              </span>
            )}
          </div>
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
      <nav className="bg-clinic-nav-bg border-b border-clinic-border-dark flex justify-center sticky top-0 z-40 shrink-0">
        <div className="flex w-full max-w-[100rem] overflow-x-auto custom-scrollbar px-1 sm:px-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex-1 min-w-[76px] sm:min-w-[132px] xl:min-w-[150px] flex flex-row items-center justify-center gap-2 xl:gap-3 px-2 sm:px-3 xl:px-4 py-3 xl:py-4 text-[10px] sm:text-xs xl:text-sm font-bold uppercase tracking-wider transition-all touch-manipulation
                ${activeTab === tab.id 
                  ? 'text-clinic-header border-b-4 border-clinic-primary bg-clinic-surface' 
                  : 'text-clinic-text-muted hover:bg-clinic-bg/60 border-b-4 border-transparent'}
              `}
            >
              <tab.icon size={16} className={cn("shrink-0", activeTab === tab.id ? 'text-clinic-primary' : '')} />
              <span className="hidden sm:inline whitespace-nowrap leading-none">{tab.label}</span>
              {'badge' in tab && !!tab.badge && (
                <span className="ml-1 min-w-5 h-5 px-1 rounded-full bg-status-orange-text text-white text-[10px] font-black flex items-center justify-center">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

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
              {activeTab === 'dashboard' && <Dashboard state={state} onUpdate={updateState} onNavigateToPatient={navigateToPatient} />}
              {activeTab === 'agenda' && <Agenda state={state} onUpdate={updateState} onNavigateToPatient={navigateToPatient} />}
              {activeTab === 'agenda-pessoal' && <PersonalAgenda state={state} onUpdate={updateState} activeAlarmId={activeAlarmId} activeAlarmLabel={activeAlarmLabel} stopAlarm={stopAlarm} />}
              {activeTab === 'atendentes' && <Patients state={state} onUpdate={updateState} selectedPatientId={selectedPatientId} setSelectedPatientId={setSelectedPatientId} currentUserName={user.displayName || user.email || 'Usuário'} currentUserId={user.uid} />}
              {activeTab === 'pre-cadastros' && <PreRegistrations state={state} onUpdate={updateState} currentUserName={user.displayName || user.email || 'Usuário'} onNavigateToPatient={navigateToPatient} />}
              {activeTab === 'pagamentos' && <Finance state={state} onUpdate={updateState} />}
              {activeTab === 'relatorios' && <Reports state={state} onUpdate={updateState} />}
              {activeTab === 'ajustes' && <Settings state={state} onUpdate={updateState} onThemeChange={updateVisualTheme} />}
            </motion.div>
          </AnimatePresence>
        </Suspense>
      </main>

      {/* Toast Notification Container placeholder */}
      <div id="toast-container" className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2"></div>

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
  );
}
