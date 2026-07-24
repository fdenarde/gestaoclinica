import React, { useEffect, useState, useMemo, useRef } from 'react';
import { AppState, Patient, SessionStatus, PaymentModal, SessionType, Session, Reposition, Payment, Evolution, ExternalRegistrationForm } from '../types';
import { Plus, Search, MessageCircle, FileText, Trash2, Edit3, DollarSign, Clock, Calendar, Users, CheckCircle, XCircle, RefreshCw, X, ChevronRight, AlertTriangle, Link as LinkIcon, ClipboardCopy, Images, Camera, Eye } from 'lucide-react';
import { calculateAge, cn, getStatusColor, formatCurrency, safeFormatDate, normalizeStr, isValidTime, normalizeTime, addOneHour, getDayOfWeekIndex, schedulesOverlap, getNextValidDates } from '../lib/utils';
import { getPatientSessionsThroughDate } from '../lib/sessionVisibility';
import { getCompletedSessions, getSessionCycleLabel, getSessionPresentationStatus, isCountedAbsenceSession } from '../lib/sessionSequence';
import { isSessionRemovedFromAgenda } from '../../shared/sessionRemoval.js';
import { buildCurrentPackageSessionSummary } from '../../shared/sessionPackageSummary.js';
import Modal from './Common/Modal';
import PatientPhoto from './Common/PatientPhoto';
import { showToast } from './Common/Toast';
import { AVAILABLE_DAYS, AVAILABLE_TIMES, CLINIC_INFO } from '../constants';
import { format, differenceInDays, parseISO, getDay, addDays } from 'date-fns';
import { createStrongToken, getExternalRegistrationExpiry, getExternalRegistrationExpiryMs, patientToExternalRegistrationData, sanitizeForFirestore } from '../lib/externalRegistration';
import { cancelPatientPhotoUpload, deletePatientPhoto, getPatientPhotoErrorMessage, uploadPatientPhoto, validatePatientPhoto } from '../lib/patientPhotoStorage';
import { auth, db } from '../firebase';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { hasPatientActivityRecords } from '../lib/activityRecordsApi';
import { getDefaultActivityAuthorization } from '../types/activityRecords';
import { getProfessionalPatientProfileChangeRequests, getProfessionalResponsibleDocumentUrl, reviewPatientProfileChangeRequest } from '../lib/accessApi';
import type { PatientProfileChangeRequest } from '../types/access';
import PatientRegistrationFields, { PatientRegistrationSummary } from './Common/PatientRegistrationFields';
import { PATIENT_REGISTRATION_FIELD_LABELS, formatPatientRegistrationValue } from '../lib/patientRegistration';
import ResponsiblePortal from './Auth/ResponsiblePortal';
import { PackageConsumptionDecisionModal } from './Common/PackageConsumptionDecisionModal';
import { calculatePackageFinancialSummary } from '../lib/financePackages';
import { createPaymentOperationKey, preparePaymentCreation, preparePaymentVoid } from '../../shared/paymentOperations.js';
import { isPaymentActive } from '../../shared/packagePayments.js';

interface PatientsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void | Promise<void>;
  selectedPatientId?: string | null;
  setSelectedPatientId?: (id: string | null) => void;
  currentUserId?: string;
  currentUserName?: string;
  initialPatientSubTab?: string | null;
  onPatientSubTabConsumed?: () => void;
  onNavigateToPatientGallery?: (id: string) => void;
}

const PATIENT_FIELD_LABELS: Record<string, string> = {
  ...PATIENT_REGISTRATION_FIELD_LABELS,
  name: '1º nome do Atendente',
  birthDate: 'nascimento',
  guardianName: '1º nome do Responsável',
  whatsapp: 'WhatsApp do Responsável',
};

function getFieldLabelForPatient(field: string) {
  return PATIENT_FIELD_LABELS[field] || field;
}

function getPatientEditDefaults(patient: Patient): Partial<Patient> {
  return {
    ...patient,
    fullName: patient.fullName || patient.name,
    sex: patient.sex || 'Não informado',
    grade: patient.grade || 'Não informado',
    careProfessionals: Array.isArray(patient.careProfessionals) ? patient.careProfessionals : [],
  };
}

function hasPatientPhoto(patient: Pick<Patient, 'photoUrl' | 'photoDriveFileId'>): boolean {
  return Boolean(patient.photoDriveFileId || patient.photoUrl);
}

function formatPortalDocumentSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Tamanho não informado';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export default function Patients({ state, onUpdate, selectedPatientId: propSelectedId, setSelectedPatientId: propSetSelectedId, currentUserId, currentUserName, initialPatientSubTab, onPatientSubTabConsumed, onNavigateToPatientGallery }: PatientsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [isNewPatientModalOpen, setIsNewPatientModalOpen] = useState(false);
  const [lastGeneratedPreRegistrationLink, setLastGeneratedPreRegistrationLink] = useState('');
  const [newPatientPhotoFile, setNewPatientPhotoFile] = useState<File | null>(null);
  const [newPatientPhotoPreviewUrl, setNewPatientPhotoPreviewUrl] = useState<string | null>(null);
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedPatientId = propSelectedId !== undefined ? propSelectedId : internalSelectedId;
  const setSelectedPatientId = propSetSelectedId || setInternalSelectedId;

  const [patientToDelete, setPatientToDelete] = useState<string | null>(null);
  const [adminPortalPreviewPatientId, setAdminPortalPreviewPatientId] = useState<string | null>(null);
  const [requestedPatientSubTab, setRequestedPatientSubTab] = useState<string | null>(initialPatientSubTab || null);

  useEffect(() => {
    if (!initialPatientSubTab) return;
    setRequestedPatientSubTab(initialPatientSubTab);
  }, [initialPatientSubTab, selectedPatientId]);
  
  // Registration Form State
  const [newPatient, setNewPatient] = useState<Partial<Patient>>({
    name: '',
    fullName: '',
    guardianName: '',
    whatsapp: '',
    sex: 'Não informado',
    grade: 'Não informado',
    careProfessionals: [],
    status: 'Ativo',
    paymentModal: PaymentModal.PIX_FULL,
    fixedDay: 'terça',
    fixedTime: '08:00',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    anamnese: {
      complaint: '',
      school: '',
      grade: '',
      referredBy: '',
      diagnoses: '',
      initialNotes: ''
    }
  });

  useEffect(() => {
    return () => {
      if (newPatientPhotoPreviewUrl) {
        URL.revokeObjectURL(newPatientPhotoPreviewUrl);
      }
    };
  }, [newPatientPhotoPreviewUrl]);

  const normalize = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const filteredPatients = state.patients.filter(p => {
    if (!showInactive && p.status === 'Concluído') return false;
    return normalize(p.name).includes(normalize(searchTerm)) || 
           normalize(p.guardianName).includes(normalize(searchTerm));
  }).sort((a,b) => a.name.localeCompare(b.name));

  const handleCreatePatient = async () => {
    if (isCreatingPatient) return;

    if (!newPatient.name?.trim() || !newPatient.fullName?.trim() || !newPatient.birthDate || !newPatient.guardianName?.trim() || !newPatient.whatsapp?.trim()) {
      showToast('Preencha os campos obrigatórios!', 'error');
      return;
    }

    if (newPatient.fixedTime && !isValidTime(newPatient.fixedTime)) {
      showToast('Por favor, insira um horário fixo válido no formato HH:00 ou HH:30 (ex: 17:30).', 'error');
      return;
    }

    const fixedTimeNormalized = newPatient.fixedTime ? normalizeTime(newPatient.fixedTime) : '08:00';
    const id = Math.random().toString(36).substr(2, 9);
    const patient: Patient = {
      ...newPatient as Patient,
      id,
      fixedTime: fixedTimeNormalized,
      anamnese: { ...newPatient.anamnese as any },
      clinicalNotes: '',
      activityMediaAuthorization: newPatient.activityMediaAuthorization || getDefaultActivityAuthorization(),
    };

    // Auto-generate the initial clinical schedule. Financial records are created only after confirmed receipt.
    const DAYS_MAP: Record<string, number> = {
      'domingo': 0, 'segunda': 1, 'terça': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6
    };
    
    const startDateRaw = patient.startDate || format(new Date(), 'yyyy-MM-dd');
    const d = parseISO(startDateRaw);
    const targetDay = DAYS_MAP[patient.fixedDay?.toLowerCase()] ?? 2;
    const currentDay = getDay(d);
    const add = (targetDay - currentDay + 7) % 7;
    const realStartDate = addDays(d, add);

    const generatedSessions: Session[] = [];
    for (let i = 0; i < 10; i++) {
      const times = [patient.fixedTime || '08:00'];
      if (patient.doubleSession) {
        times.push(addOneHour(patient.fixedTime || '08:00'));
      }
      for (const time of times) {
        const sessionNumberInCycle = (generatedSessions.length % 10) + 1;
        generatedSessions.push({
          id: Math.random().toString(36).substr(2, 9),
          patientId: id,
          date: format(addDays(realStartDate, i * 7), 'yyyy-MM-dd'),
          time,
          type: patient.doubleSession ? SessionType.DUPLA : SessionType.SIMPLES,
          status: SessionStatus.AGENDADA,
          packageNumber: sessionNumberInCycle,
          isFixedSchedule: true,
          source: 'fixed'
        });
      }
    }

    let uploadedPhotoPath: string | undefined;
    setIsCreatingPatient(true);

    try {
      if (newPatientPhotoFile) {
        if (!currentUserId) {
          throw new Error('Usuário não identificado para enviar a foto.');
        }

        const uploadedPhoto = await uploadPatientPhoto(currentUserId, id, newPatientPhotoFile);
        patient.photoUrl = '';
        patient.photoStorageProvider = 'google-drive';
        patient.photoDriveFileId = uploadedPhoto.driveFileId;
        patient.photoDriveFileName = uploadedPhoto.fileName;
        patient.photoMimeType = uploadedPhoto.mimeType;
        patient.photoStoragePath = uploadedPhoto.storagePath;
        uploadedPhotoPath = uploadedPhoto.storagePath;
      }

      await Promise.resolve(onUpdate({
        patients: [...state.patients, patient],
        sessions: [...state.sessions, ...generatedSessions]
      }));

      showToast('Atendente e ciclo inicial cadastrados com sucesso!');
      setIsNewPatientModalOpen(false);
      resetNewPatientForm();
    } catch (error) {
      if (uploadedPhotoPath) {
        await deletePatientPhoto(uploadedPhotoPath).catch(cleanupError => {
          console.error('Não foi possível remover a foto após a falha do cadastro:', cleanupError);
        });
      }

      console.error('Erro ao cadastrar atendente:', error);
      showToast(getPatientPhotoErrorMessage(error), 'error');
    } finally {
      setIsCreatingPatient(false);
    }
  };

  const resetNewPatientForm = () => {
    setNewPatient({
      name: '',
      fullName: '',
      guardianName: '',
      whatsapp: '',
      sex: 'Não informado',
      grade: 'Não informado',
      careProfessionals: [],
      status: 'Ativo',
      paymentModal: PaymentModal.PIX_FULL,
      fixedDay: 'terça',
      fixedTime: '08:00',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      anamnese: {
        complaint: '',
        school: '',
        grade: '',
        referredBy: '',
        diagnoses: '',
        initialNotes: ''
      }
    });
    setNewPatientPhotoFile(null);
    setNewPatientPhotoPreviewUrl(null);
  };

  const closeNewPatientModal = () => {
    if (isCreatingPatient) return;
    setIsNewPatientModalOpen(false);
    resetNewPatientForm();
  };

  const confirmDelete = async () => {
    if (!patientToDelete) return;

    const patientBeingDeleted = state.patients.find(item => item.id === patientToDelete);
    const updatedPatients = state.patients.filter(p => p.id !== patientToDelete);
    const updatedSessions = state.sessions.filter(s => s.patientId !== patientToDelete);
    const updatedRepositions = state.repositions.filter(r => r.patientId !== patientToDelete);

    try {
      if (state.payments.some(payment => payment.patientId === patientToDelete)) {
        showToast('Este atendente possui histórico financeiro. Desative o cadastro para preservar os lançamentos.', 'error');
        return;
      }
      if (currentUserId && await hasPatientActivityRecords(patientToDelete)) {
        showToast('Este atendente possui registros históricos de atividades preservados. O cadastro não pode ser excluído sem uma auditoria específica desses dados.', 'error');
        return;
      }

      await Promise.resolve(onUpdate({
        patients: updatedPatients,
        sessions: updatedSessions,
        repositions: updatedRepositions
      }));

      const photoReference = patientBeingDeleted?.photoDriveFileId || patientBeingDeleted?.photoStoragePath;
      if (photoReference) {
        await deletePatientPhoto(photoReference).catch(cleanupError => {
          console.error('O cadastro foi excluído, mas a foto não pôde ser removida do Google Drive:', cleanupError);
        });
      }

      showToast('Atendente excluído.');
      setPatientToDelete(null);
    } catch (error) {
      console.error('Erro ao excluir atendente:', error);
      showToast('Não foi possível excluir o atendente. Nenhum dado foi dado como removido.', 'error');
    }
  };

  const selectedPatient = state.patients.find(p => p.id === selectedPatientId);
  const adminPortalPreviewPatient = state.patients.find(p => p.id === adminPortalPreviewPatientId) || null;
  const isPrimaryAdmin = auth.currentUser?.email?.trim().toLowerCase() === 'fdenarde@gmail.com';

  const copyExternalRegistrationLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      showToast('Link copiado para envio manual pelo WhatsApp.', 'success');
    } catch {
      window.prompt('Copie o link para enviar manualmente:', link);
    }
  };

  const createExternalRegistrationForm = async (type: 'new' | 'update', linkedPatient?: Patient) => {
    if (!currentUserId) {
      showToast('Usuário não identificado para gerar o link.', 'error');
      return '';
    }

    const token = createStrongToken();
    const now = new Date().toISOString();
    const expiresAtMs = getExternalRegistrationExpiryMs();
    const currentData = type === 'update' && linkedPatient ? patientToExternalRegistrationData(linkedPatient) : undefined;
    const form: ExternalRegistrationForm = {
      id: token,
      token,
      ownerUserId: currentUserId,
      type,
      status: 'Pendente de preenchimento',
      patientId: type === 'update' ? linkedPatient?.id || null : null,
      patientSnapshot: type === 'update' && linkedPatient ? {
        id: linkedPatient.id || '',
        name: linkedPatient.name || '',
        birthDate: linkedPatient.birthDate || '',
        guardianName: linkedPatient.guardianName || '',
        whatsapp: linkedPatient.whatsapp || '',
        school: linkedPatient.school || '',
        grade: linkedPatient.grade || '',
        shift: linkedPatient.shift || '',
        doctorName: linkedPatient.doctorName || '',
        medication: linkedPatient.medication || '',
      } : null,
      currentData,
      createdAt: now,
      expiresAt: getExternalRegistrationExpiry(),
      expiresAtMs,
      expiresAtTimestamp: Timestamp.fromMillis(expiresAtMs),
      reviewedBy: currentUserName || 'Usuário',
    };

    await setDoc(doc(db, 'externalRegistrationForms', token), sanitizeForFirestore(form));
    return `${window.location.origin}/pre-cadastro/${token}`;
  };

  const generateNewPreRegistrationLink = async () => {
    try {
      const link = await createExternalRegistrationForm('new');
      if (!link) return;
      setLastGeneratedPreRegistrationLink(link);
      await copyExternalRegistrationLink(link);
    } catch (error) {
      console.error('Erro ao gerar link de pré-cadastro:', error);
      showToast('Não foi possível criar o link. Confira o console e as permissões do Firestore.', 'error');
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-clinic-surface p-4 rounded-2xl border border-clinic-border shadow-sm">
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={20} />
            <input 
              type="text" 
              placeholder="Buscar por nome do atendente ou responsável..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer mt-2 md:mt-0 text-sm font-medium text-clinic-text-muted hover:text-clinic-text transition-colors">
            <input 
              type="checkbox" 
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="w-4 h-4 rounded text-clinic-primary accent-clinic-primary bg-clinic-bg border-clinic-border focus:ring-clinic-primary"
            />
            Mostrar Concluídos
          </label>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          <button
            type="button"
            onClick={generateNewPreRegistrationLink}
            className="flex items-center gap-2 px-5 py-3 bg-status-blue-bg text-status-blue-text border border-status-blue-text/20 font-bold rounded-xl shadow-sm hover:bg-status-blue-bg/70 transition-all uppercase tracking-widest text-xs w-full sm:w-auto justify-center"
          >
            <LinkIcon size={18} />
            Gerar link de novo pré-cadastro
          </button>
          <button
            onClick={() => setIsNewPatientModalOpen(true)}
            className="flex items-center gap-2 px-6 py-3 bg-clinic-primary text-white font-bold rounded-xl shadow-lg hover:bg-clinic-primary-hover transition-all uppercase tracking-widest text-sm w-full sm:w-auto justify-center"
          >
            <Plus size={20} />
            Novo Atendente
          </button>
        </div>
      </div>

      {lastGeneratedPreRegistrationLink && (
        <div className="bg-clinic-surface border border-clinic-border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2 shadow-sm">
          <input
            readOnly
            value={lastGeneratedPreRegistrationLink}
            className="flex-1 px-3 py-2 bg-clinic-bg rounded-lg border border-clinic-border text-xs text-clinic-text"
          />
          <button
            type="button"
            onClick={() => copyExternalRegistrationLink(lastGeneratedPreRegistrationLink)}
            className="px-3 py-2 bg-clinic-header text-white rounded-lg text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-2"
          >
            <ClipboardCopy size={14} /> Copiar
          </button>
        </div>
      )}

      <div className="bg-clinic-surface rounded-2xl border border-clinic-border shadow-sm overflow-hidden">
        <div className="p-6 space-y-4">
          {filteredPatients.length > 0 ? (
            filteredPatients.map(patient => {
              const totalRealized = getCompletedSessions(state.sessions, patient.id, format(new Date(), 'yyyy-MM-dd')).length;
              const attendedInCycle = totalRealized % 10;
              const remainingInCycle = attendedInCycle === 0 && totalRealized > 0 ? 0 : 10 - attendedInCycle;
              // If exactly 10, 20, etc sessions are realized, we show 10 realized and 0 remaining for that cycle
              const displayAttended = attendedInCycle === 0 && totalRealized > 0 ? 10 : attendedInCycle;
              const displayRemaining = attendedInCycle === 0 && totalRealized > 0 ? 0 : 10 - attendedInCycle;

              const hasPendingReposition = state.repositions.some(r => r.patientId === patient.id && r.status === 'Pendente');
              
              return (
                <div key={patient.id} className="p-5 rounded-2xl border border-clinic-border hover:bg-clinic-bg/40 transition-all flex flex-col md:flex-row items-center gap-6">
                  <PatientPhoto
                    patient={patient}
                    expandable
                    alt={`Foto de ${patient.name}`}
                    className="w-14 h-14 rounded-full object-cover border-2 border-clinic-primary/20 shrink-0 shadow-sm transition-transform hover:scale-105"
                    fallbackClassName="w-14 h-14 rounded-full bg-clinic-primary/10 text-clinic-primary flex items-center justify-center text-xl font-bold border-2 border-clinic-primary/20 shrink-0"
                  />
                  
                  <div className="flex-1 min-w-0 w-full text-center md:text-left">
                    <div className="flex flex-col md:flex-row items-center gap-2 mb-1">
                      <h3 className="text-xl font-bold truncate leading-tight">{patient.name}</h3>
                      <span className="text-xs text-clinic-text-muted px-2 py-0.5 bg-clinic-bg rounded-full">{calculateAge(patient.birthDate)} anos</span>
                    </div>
                    <div className="flex flex-col md:flex-row items-center gap-x-4 gap-y-1 text-sm text-clinic-text-muted">
                      <span className="font-medium whitespace-nowrap">Responsável: {patient.guardianName}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={14} className="text-status-green-text" /> {patient.whatsapp}</span>
                    </div>
                    
                    <div className="mt-4 flex flex-col md:flex-row items-center gap-4">
                      <div className="flex-1 w-full max-w-sm space-y-1">
                        <div className="flex justify-between text-[10px] font-bold uppercase text-clinic-text-faint">
                          <span>Progresso do Pacote</span>
                          <span>{displayAttended} contabilizadas • {displayRemaining} restantes</span>
                        </div>
                        <div className="w-full h-1.5 bg-clinic-bg rounded-full overflow-hidden">
                          <div className="h-full bg-clinic-primary rounded-full transition-all duration-700" style={{ width: `${(displayAttended/10)*100}%` }}></div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {patient.status === 'Ativo' ? (
                          <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-status-green-bg text-status-green-text">Ativo</span>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-clinic-bg text-clinic-text-muted">Concluído</span>
                        )}
                        {hasPendingReposition && (
                          <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-status-orange-bg text-status-orange-text">Falta Pendente</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto justify-center">
                    <a 
                      href={`https://wa.me/55${patient.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 bg-status-green-bg text-status-green-text rounded-xl hover:scale-105 transition-transform"
                      title="WhatsApp"
                    >
                      <MessageCircle size={20} />
                    </a>
                    <button
                      type="button"
                      onClick={() => onNavigateToPatientGallery?.(patient.id)}
                      className="p-3 rounded-xl bg-status-blue-bg text-status-blue-text transition-all hover:scale-105"
                      title={`Abrir Galeria de Atividades de ${patient.name}`}
                      aria-label={`Abrir Galeria de Atividades de ${patient.name}`}
                    >
                      <Camera size={20} />
                    </button>
                    {isPrimaryAdmin && (
                      <button
                        type="button"
                        onClick={() => setAdminPortalPreviewPatientId(patient.id)}
                        className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-indigo-700 transition-all hover:scale-105 hover:bg-indigo-100"
                        title={`Abrir o Portal do Responsável de ${patient.name} em modo administrativo`}
                        aria-label={`Ver Portal do Responsável de ${patient.name}`}
                      >
                        <Eye size={18} />
                        <span className="hidden xl:inline">Portal do Responsável</span>
                        <span className="xl:hidden">Portal</span>
                      </button>
                    )}
                    <button 
                      onClick={() => setSelectedPatientId(patient.id)}
                      className="flex items-center gap-2 px-5 py-3 bg-clinic-header text-white font-bold rounded-xl text-xs uppercase tracking-wider hover:bg-clinic-text transition-colors shadow-md"
                    >
                      <FileText size={18} />
                      Ver Detalhes
                    </button>
                    <button 
                      onClick={() => setPatientToDelete(patient.id)}
                      className="p-3 text-status-red-text hover:bg-status-red-bg rounded-xl transition-all"
                      title="Excluir"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-20 text-center text-clinic-text-muted">
              <p className="text-lg italic opacity-50">Nenhum atendente encontrado.</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal Novo Atendente */}
      <Modal 
        isOpen={isNewPatientModalOpen} 
        onClose={closeNewPatientModal} 
        title="Cadastrar Novo Atendente"
        width="max-w-6xl"
      >
        <div className="space-y-8">
          <PatientRegistrationFields
            value={newPatient}
            onChange={patch => setNewPatient(current => ({ ...current, ...patch }))}
            disabled={isCreatingPatient}
            requiredCore
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
              <h4 className="mb-4 flex items-center gap-2 border-b border-clinic-border pb-2 text-base font-black text-clinic-text">
                <Images size={17} className="text-clinic-primary" /> Arquivos do Atendente
              </h4>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Foto do Atendente</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={isCreatingPatient}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      try {
                        validatePatientPhoto(file);
                        setNewPatientPhotoFile(file);
                        setNewPatientPhotoPreviewUrl(current => {
                          if (current) URL.revokeObjectURL(current);
                          return URL.createObjectURL(file);
                        });
                      } catch (error) {
                        setNewPatientPhotoFile(null);
                        setNewPatientPhotoPreviewUrl(null);
                        event.currentTarget.value = '';
                        showToast(getPatientPhotoErrorMessage(error), 'error');
                      }
                    }}
                    className="block w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2 text-sm text-clinic-text-muted file:mr-4 file:rounded-full file:border-0 file:bg-clinic-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                {newPatientPhotoPreviewUrl && (
                  <div className="flex items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg/50 p-3">
                    <img src={newPatientPhotoPreviewUrl} alt="Prévia da foto do atendente" className="h-14 w-14 rounded-full border border-clinic-border object-cover" />
                    <p className="text-xs text-clinic-text-muted">A foto será enviada ao Google Drive somente quando o cadastro for salvo.</p>
                  </div>
                )}
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Relatório em PDF</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={isCreatingPatient}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onloadend = () => setNewPatient(current => ({ ...current, reportPdfUrl: reader.result as string }));
                      reader.readAsDataURL(file);
                    }}
                    className="block w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2 text-sm text-clinic-text-muted file:mr-4 file:rounded-full file:border-0 file:bg-clinic-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Parecer em PDF</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={isCreatingPatient}
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onloadend = () => setNewPatient(current => ({ ...current, opinionPdfUrl: reader.result as string }));
                      reader.readAsDataURL(file);
                    }}
                    className="block w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2 text-sm text-clinic-text-muted file:mr-4 file:rounded-full file:border-0 file:bg-clinic-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
              <h4 className="mb-4 flex items-center gap-2 border-b border-clinic-border pb-2 text-base font-black text-clinic-text">
                <Clock size={17} className="text-clinic-primary" /> Configuração do Pacote
              </h4>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Dia fixo</span>
                    <select value={newPatient.fixedDay || ''} onChange={event => setNewPatient(current => ({ ...current, fixedDay: event.target.value }))} disabled={isCreatingPatient} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary">
                      {AVAILABLE_DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Horário fixo</span>
                    <select
                      value={AVAILABLE_TIMES.includes(newPatient.fixedTime || '') ? newPatient.fixedTime : 'custom'}
                      onChange={event => setNewPatient(current => ({ ...current, fixedTime: event.target.value === 'custom' ? '17:30' : event.target.value }))}
                      disabled={isCreatingPatient}
                      className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary"
                    >
                      {AVAILABLE_TIMES.map(time => <option key={time} value={time}>{time}</option>)}
                      <option value="custom">Outro horário...</option>
                    </select>
                    {(!newPatient.fixedTime || !AVAILABLE_TIMES.includes(newPatient.fixedTime)) && (
                      <input type="text" placeholder="Ex.: 17:30" value={newPatient.fixedTime || ''} onChange={event => setNewPatient(current => ({ ...current, fixedTime: event.target.value }))} disabled={isCreatingPatient} className="mt-2 w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" />
                    )}
                  </label>
                </div>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg p-3">
                  <input type="checkbox" checked={Boolean(newPatient.doubleSession)} onChange={event => setNewPatient(current => ({ ...current, doubleSession: event.target.checked }))} disabled={isCreatingPatient} className="h-4 w-4 accent-clinic-primary" />
                  <span>
                    <span className="block text-sm font-bold text-clinic-text">Sessão dupla (2 × 50 min)</span>
                    <span className="block text-[10px] text-clinic-text-muted">Ocupa dois horários consecutivos na agenda.</span>
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Modalidade de pagamento</span>
                  <select value={newPatient.paymentModal || PaymentModal.PIX_FULL} onChange={event => setNewPatient(current => ({ ...current, paymentModal: event.target.value as PaymentModal }))} disabled={isCreatingPatient} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary">
                    <option value={PaymentModal.PIX_FULL}>{PaymentModal.PIX_FULL}</option>
                    <option value={PaymentModal.PARCELADO}>{PaymentModal.PARCELADO}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Início do pacote</span>
                  <input type="date" value={newPatient.startDate || ''} onChange={event => setNewPatient(current => ({ ...current, startDate: event.target.value }))} disabled={isCreatingPatient} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" />
                </label>
              </div>
            </section>
          </div>


          <button 
            onClick={handleCreatePatient}
            disabled={isCreatingPatient}
            className="w-full py-4 bg-clinic-primary text-white font-bold rounded-xl shadow-xl hover:bg-clinic-primary-hover transition-all uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreatingPatient ? 'Salvando atendente...' : 'Salvar Atendente'}
          </button>
        </div>
      </Modal>

      {/* Modal Confirmar Exclusão */}
      <Modal
        isOpen={!!patientToDelete}
        onClose={() => setPatientToDelete(null)}
        title="Confirmar Exclusão"
        width="max-w-md"
      >
        <div className="space-y-6">
          <p className="text-clinic-text">
            Deseja realmente excluir este atendente? Todos os dados vinculados (sessões, pagamentos, etc) serão perdidos.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setPatientToDelete(null)}
              className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
            >
              Cancelar
            </button>
            <button
              onClick={confirmDelete}
              className="px-4 py-2 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all uppercase tracking-wide text-xs"
            >
              Excluir Atendente
            </button>
          </div>
        </div>
      </Modal>

      {isPrimaryAdmin && adminPortalPreviewPatient && auth.currentUser && (
        <div className="fixed inset-0 z-[250] overflow-y-auto bg-clinic-bg">
          <ResponsiblePortal
            user={auth.currentUser}
            adminPreview={{
              patientId: adminPortalPreviewPatient.id,
              patientName: adminPortalPreviewPatient.fullName || adminPortalPreviewPatient.name,
              onBack: () => setAdminPortalPreviewPatientId(null),
            }}
          />
        </div>
      )}

      {/* Modal Detalhes do Atendente */}
      {selectedPatientId && selectedPatient && (
        <PatientDetailsModal 
          key={selectedPatientId}
          isOpen={true} 
          onClose={() => setSelectedPatientId(null)} 
          patient={selectedPatient}
          state={state}
          onUpdate={onUpdate}
          currentUserId={currentUserId || ''}
          currentUserName={currentUserName || 'Usuário'}
          createExternalRegistrationForm={createExternalRegistrationForm}
          copyExternalRegistrationLink={copyExternalRegistrationLink}
          onNavigateToPatientGallery={onNavigateToPatientGallery}
          initialSubTab={requestedPatientSubTab}
          onInitialSubTabApplied={() => {
            setRequestedPatientSubTab(null);
            onPatientSubTabConsumed?.();
          }}
        />
      )}
    </div>
  );
}

function PatientDetailsModal({ isOpen, onClose, patient, state, onUpdate, currentUserId, currentUserName, createExternalRegistrationForm, copyExternalRegistrationLink, onNavigateToPatientGallery, initialSubTab, onInitialSubTabApplied }: { key?: string, isOpen: boolean, onClose: () => void, patient: Patient, state: AppState, onUpdate: (s: Partial<AppState>) => void | Promise<void>, currentUserId: string, currentUserName: string, createExternalRegistrationForm: (type: 'new' | 'update', linkedPatient?: Patient) => Promise<string>, copyExternalRegistrationLink: (link: string) => Promise<void>, onNavigateToPatientGallery?: (id: string) => void, initialSubTab?: string | null, onInitialSubTabApplied?: () => void }) {
  const [activeSubTab, setActiveSubTab] = useState(initialSubTab && initialSubTab !== 'atividades' ? initialSubTab : 'dados');
  const [isEditingData, setIsEditingData] = useState(false);
  const [isPhotoExpanded, setIsPhotoExpanded] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Patient>>(() => getPatientEditDefaults(patient));
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoPreviewUrl, setPendingPhotoPreviewUrl] = useState<string | null>(null);
  const [isSavingData, setIsSavingData] = useState(false);
  const [repositionModalSession, setRepositionModalSession] = useState<Session | null>(null);
  const [repoDate, setRepoDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [repoTime, setRepoTime] = useState(patient?.fixedTime || '08:00');
  
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentOperationKey, setPaymentOperationKey] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const paymentWriteLockRef = useRef(false);
  const [paymentData, setPaymentData] = useState<{
    id?: string;
    date: string;
    installment: '1ª parcela' | '2ª parcela' | 'Pagamento integral';
    amount: number;
    method: 'Pix' | 'Dinheiro' | 'Transferência' | 'Outro';
    packageNumber: number;
  }>({
    date: format(new Date(), 'yyyy-MM-dd'),
    installment: patient?.paymentModal === PaymentModal.PIX_FULL ? 'Pagamento integral' : '1ª parcela',
    amount: patient?.paymentModal === PaymentModal.PIX_FULL ? 1000 : 500,
    method: 'Pix',
    packageNumber: 1
  });

  const [confirmInactivate, setConfirmInactivate] = useState(false);
  const [confirmNewPackage, setConfirmNewPackage] = useState(false);
  const [confirmScheduleChange, setConfirmScheduleChange] = useState<{
    oldDay: string;
    oldTime: string;
    oldDouble: boolean;
    newDay: string;
    newTime: string;
    newDouble: boolean;
    conflictingNames: string[];
  } | null>(null);
  const [absenceDecisionModal, setAbsenceDecisionModal] = useState<{
    sessionId: string;
    consumesPackage: boolean | null;
    isEditing: boolean;
  } | null>(null);
  
  const [newEvoDate, setNewEvoDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newEvoNotes, setNewEvoNotes] = useState('');
  const [lastGeneratedExternalLink, setLastGeneratedExternalLink] = useState('');
  const [profileChangeRequests, setProfileChangeRequests] = useState<PatientProfileChangeRequest[]>([]);
  const [profileRequestsLoading, setProfileRequestsLoading] = useState(false);
  const [profileRequestReviewingId, setProfileRequestReviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialSubTab) return;
    setActiveSubTab(initialSubTab === 'atividades' ? 'dados' : initialSubTab);
    onInitialSubTabApplied?.();
  }, [initialSubTab, onInitialSubTabApplied]);

  useEffect(() => {
    if (!isOpen || !patient.id) return;
    let active = true;
    setProfileRequestsLoading(true);
    void getProfessionalPatientProfileChangeRequests(patient.id)
      .then(requests => {
        if (active) setProfileChangeRequests(requests);
      })
      .catch(error => {
        console.error('Erro ao carregar solicitações cadastrais:', error);
        if (active) showToast(error instanceof Error ? error.message : 'Não foi possível carregar as solicitações cadastrais.', 'error');
      })
      .finally(() => {
        if (active) setProfileRequestsLoading(false);
      });
    return () => { active = false; };
  }, [isOpen, patient.id]);
  useEffect(() => {
    return () => {
      if (pendingPhotoPreviewUrl) {
        URL.revokeObjectURL(pendingPhotoPreviewUrl);
      }
    };
  }, [pendingPhotoPreviewUrl]);

  if (!patient) return null;

  const patientSessions = state.sessions.filter(s => s.patientId === patient.id && !isSessionRemovedFromAgenda(s)).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const visiblePatientSessions = getPatientSessionsThroughDate({
    patient,
    sessions: state.sessions,
  }).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
  const patientPayments = state.payments.filter(p => p.patientId === patient.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const activePatientPayments = patientPayments.filter(isPaymentActive);
  const packageFinancialSummary = calculatePackageFinancialSummary(patient, state.sessions, state.payments, new Date());
  const patientEvolutions = (state.evolutions || []).filter(e => e.patientId === patient.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latestExternalHistory = patient.externalRegistrationHistory?.[patient.externalRegistrationHistory.length - 1];

  const getInferredPackageNumber = (paymentDate: string) => {
    if (patientSessions.length === 0) return 1;
    const chronologicalSessions = [...patientSessions].sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const targetTime = new Date(paymentDate).getTime();
    let closestIndex = 0;
    let minDiff = Infinity;
    chronologicalSessions.forEach((s, index) => {
       const diff = Math.abs(new Date(s.date).getTime() - targetTime);
       if (diff < minDiff) {
          minDiff = diff;
          closestIndex = index;
       }
    });
    return Math.floor(closestIndex / 10) + 1;
  };

  const handleSaveEvolution = () => {
    if (!newEvoNotes.trim()) return;
    const newEvolution: Evolution = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: patient.id,
      date: newEvoDate,
      notes: newEvoNotes.trim()
    };
    onUpdate({ evolutions: [...(state.evolutions || []), newEvolution] });
    setNewEvoNotes('');
    showToast('Evolução salva com sucesso!');
  };

  const downloadResponsibleDocument = async (documentId: string, fileName: string) => {
    try {
      const result = await getProfessionalResponsibleDocumentUrl(patient.id, documentId);
      const url = new URL(result.url, window.location.origin);
      url.searchParams.set('download', '1');
      const anchor = window.document.createElement('a');
      anchor.href = url.toString();
      anchor.download = result.fileName || fileName;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('Falha ao abrir documento enviado pelo responsável:', error);
      showToast(error instanceof Error ? error.message : 'Não foi possível abrir o documento.', 'error');
    }
  };

  const generateExternalRegistrationLink = async () => {
    try {
      const link = await createExternalRegistrationForm('update', patient);
      if (!link) return;
      setLastGeneratedExternalLink(link);
      await copyExternalRegistrationLink(link);
    } catch (error) {
      console.error('Erro ao gerar link de atualização cadastral:', error);
      showToast('Não foi possível criar o link. Confira o console e as permissões do Firestore.', 'error');
    }
  };

  const handleReviewProfileChangeRequest = async (request: PatientProfileChangeRequest, decision: 'approved' | 'rejected') => {
    if (profileRequestReviewingId) return;
    let rejectionReason = '';
    if (decision === 'rejected') {
      const informedReason = window.prompt('Informe o motivo da recusa. Este texto ficará registrado no histórico:', request.rejectionReason || '');
      if (informedReason === null) return;
      rejectionReason = informedReason.trim();
    }

    setProfileRequestReviewingId(request.id);
    try {
      const result = await reviewPatientProfileChangeRequest(request.id, decision, rejectionReason);
      setProfileChangeRequests(current => current.map(item => item.id === request.id ? result.request : item));
      if (decision === 'approved' && result.patient) {
        setEditForm(current => ({ ...current, ...result.patient }));
      }
      showToast(
        decision === 'approved'
          ? 'Solicitação aprovada. O cadastro oficial foi atualizado.'
          : 'Solicitação recusada sem alterar o cadastro oficial.',
        'success',
      );
    } catch (error) {
      console.error('Erro ao analisar solicitação cadastral:', error);
      showToast(error instanceof Error ? error.message : 'Não foi possível analisar a solicitação cadastral.', 'error');
    } finally {
      setProfileRequestReviewingId(null);
    }
  };
  // Realized sessions sorted chronologically (ascending)
  const realizedSessionsChronological = getCompletedSessions(state.sessions, patient.id, format(new Date(), 'yyyy-MM-dd'))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const realizedCount = realizedSessionsChronological.length;
  const realizedInPackage = buildCurrentPackageSessionSummary(
    patient,
    state.sessions,
    10,
    { throughDate: format(new Date(), 'yyyy-MM-dd') },
  ).count;

  const isLate = packageFinancialSummary.status === 'ATRASADO';
  let daysLate = 0;
  if (isLate && packageFinancialSummary.dueDate) {
    daysLate = Math.max(0, differenceInDays(new Date(), new Date(packageFinancialSummary.dueDate)));
  }

  const clearPendingPhoto = () => {
    setPendingPhotoFile(null);
    setPendingPhotoPreviewUrl(null);
  };

  const cancelEditingData = () => {
    if (isSavingData) {
      const canceled = cancelPatientPhotoUpload(patient.id);
      showToast(
        canceled
          ? 'Cancelando o envio da foto...'
          : 'A gravação do cadastro já está sendo confirmada. Aguarde alguns segundos.',
        canceled ? 'success' : 'error',
      );
      return;
    }

    setEditForm(getPatientEditDefaults(patient));
    clearPendingPhoto();
    setIsEditingData(false);
  };

  const requestClosePatientModal = () => {
    if (isSavingData) {
      const canceled = cancelPatientPhotoUpload(patient.id);
      showToast(
        canceled
          ? 'Cancelando o envio da foto...'
          : 'A gravação do cadastro já está sendo confirmada. Aguarde alguns segundos.',
        canceled ? 'success' : 'error',
      );
      return;
    }

    onClose();
  };

  const persistPatientUpdate = async (
    basePatient: Patient,
    additionalState: Omit<Partial<AppState>, 'patients'>,
    successMessage: string,
    successType: 'success' | 'error' = 'success',
  ): Promise<boolean> => {
    if (isSavingData) return false;

    setIsSavingData(true);
    let uploadedPhotoPath: string | undefined;

    try {
      let patientToSave = basePatient;

      if (pendingPhotoFile) {
        const uploadedPhoto = await uploadPatientPhoto(currentUserId, patient.id, pendingPhotoFile);
        uploadedPhotoPath = uploadedPhoto.storagePath;
        patientToSave = {
          ...basePatient,
          photoUrl: '',
          photoStorageProvider: 'google-drive',
          photoDriveFileId: uploadedPhoto.driveFileId,
          photoDriveFileName: uploadedPhoto.fileName,
          photoMimeType: uploadedPhoto.mimeType,
          photoStoragePath: uploadedPhoto.storagePath,
        };
      }

      const updatedPatients = state.patients.map(currentPatient =>
        currentPatient.id === patient.id ? patientToSave : currentPatient
      );

      await Promise.resolve(onUpdate({
        ...additionalState,
        patients: updatedPatients,
      }));

      const previousPhotoReference = patient.photoDriveFileId || patient.photoStoragePath;
      if (
        uploadedPhotoPath &&
        previousPhotoReference &&
        previousPhotoReference !== uploadedPhotoPath
      ) {
        await deletePatientPhoto(previousPhotoReference).catch(cleanupError => {
          console.error('Não foi possível remover a foto anterior do atendente:', cleanupError);
        });
      }

      setEditForm(patientToSave);
      clearPendingPhoto();
      setIsEditingData(false);
      showToast(successMessage, successType);
      return true;
    } catch (error) {
      if (uploadedPhotoPath) {
        await deletePatientPhoto(uploadedPhotoPath).catch(cleanupError => {
          console.error('Não foi possível remover a nova foto após a falha da gravação:', cleanupError);
        });
      }

      console.error('Erro ao salvar dados do atendente:', error);
      showToast(getPatientPhotoErrorMessage(error), 'error');
      return false;
    } finally {
      setIsSavingData(false);
    }
  };

  const handleSavePatientData = async () => {
    if (isSavingData) return;

    if (!editForm.name?.trim() || !editForm.fullName?.trim() || !editForm.birthDate || !editForm.guardianName?.trim() || !editForm.whatsapp?.trim()) {
      showToast('Preencha o 1º nome e o nome completo do Atendente, a data de nascimento, o 1º nome do Responsável e o WhatsApp do Responsável.', 'error');
      return;
    }

    if (editForm.fixedTime && !isValidTime(editForm.fixedTime)) {
      showToast('Por favor, insira um horário fixo válido no formato HH:00 ou HH:30 (ex: 17:30).', 'error');
      return;
    }

    const normalized = editForm.fixedTime ? normalizeTime(editForm.fixedTime) : '';
    const normalizedEditForm = { ...editForm, fixedTime: normalized };
    setEditForm(normalizedEditForm);

    const isBecomingInactive = normalizedEditForm.status === 'Concluído' && patient.status !== 'Concluído';

    if (isBecomingInactive) {
      setConfirmInactivate(true);
      return;
    }

    const isFixedDayChanged = normalizedEditForm.fixedDay !== patient.fixedDay;
    const isFixedTimeChanged = normalizedEditForm.fixedTime !== patient.fixedTime;
    const isDoubleSessionChanged = !!normalizedEditForm.doubleSession !== !!patient.doubleSession;

    if (isFixedDayChanged || isFixedTimeChanged || isDoubleSessionChanged) {
      const conflicts = state.patients.filter(p =>
        p.id !== patient.id &&
        p.status === 'Ativo' &&
        schedulesOverlap(
          p.fixedDay || '',
          p.fixedTime || '',
          !!p.doubleSession,
          normalizedEditForm.fixedDay || '',
          normalizedEditForm.fixedTime || '',
          !!normalizedEditForm.doubleSession
        )
      );

      setConfirmScheduleChange({
        oldDay: patient.fixedDay || '',
        oldTime: patient.fixedTime || '',
        oldDouble: !!patient.doubleSession,
        newDay: normalizedEditForm.fixedDay || '',
        newTime: normalizedEditForm.fixedTime || '',
        newDouble: !!normalizedEditForm.doubleSession,
        conflictingNames: conflicts.map(c => c.name)
      });
      return;
    }

    await executeSavePatientData(false, normalizedEditForm);
  };

  const executeSavePatientData = async (
    deleteFutureSessions: boolean,
    formToSave: Partial<Patient> = editForm,
  ) => {
    const basePatient = { ...patient, ...formToSave } as Patient;

    if (deleteFutureSessions) {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const updatedSessions = state.sessions.filter(s => {
        if (s.patientId !== patient.id) return true;
        if (s.status === SessionStatus.AGENDADA && s.date >= todayStr) return false;
        return true;
      });
      const updatedRepositions = state.repositions.filter(r => {
        if (r.patientId !== patient.id) return true;
        if (r.status === 'Pendente') return false;
        if (r.status === 'Agendada') return false;
        return true;
      });

      const saved = await persistPatientUpdate(
        basePatient,
        {
          sessions: updatedSessions,
          repositions: updatedRepositions,
        },
        'Atendente desativado e sessões futuras removidas.',
        'error',
      );

      if (saved) setConfirmInactivate(false);
      return;
    }

    const saved = await persistPatientUpdate(
      basePatient,
      {},
      'Dados atualizados com sucesso!',
    );

    if (saved) setConfirmInactivate(false);
  };

  const executeSavePatientDataWithRealignment = async (realign: boolean) => {
    if (!confirmScheduleChange || isSavingData) return;

    let updatedSessions = [...state.sessions];

    if (realign) {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const holidays = state.settings.holidays || [];

      const oldSessionsToRealign = state.sessions.filter(s => {
        if (s.patientId !== patient.id) return false;
        if (s.status !== SessionStatus.AGENDADA) return false;
        if (s.date < todayStr) return false;
        if (s.isBlocked) return false;

        const dayOfWeekIndex = getDayOfWeekIndex(confirmScheduleChange.oldDay);
        const sessionDayOfWeek = getDay(parseISO(s.date));
        if (sessionDayOfWeek !== dayOfWeekIndex) return false;

        const isOldTime = s.time === confirmScheduleChange.oldTime;
        const isOldSecondSlot = confirmScheduleChange.oldDouble && s.time === addOneHour(confirmScheduleChange.oldTime);
        if (!isOldTime && !isOldSecondSlot) return false;

        if (s.packageNumber === 0) return false;
        const notesLower = (s.notes || '').toLowerCase();
        if (notesLower.includes('reposição') || notesLower.includes('reposicao') || notesLower.includes('extra') || notesLower.includes('manual')) return false;

        return true;
      });

      if (oldSessionsToRealign.length > 0) {
        const uniqueDates = Array.from(new Set(oldSessionsToRealign.map(s => s.date))).sort();
        const numWeeks = uniqueDates.length;
        const newDates = getNextValidDates(confirmScheduleChange.newDay, todayStr, numWeeks, holidays);

        const oldSessionsSorted = [...oldSessionsToRealign].sort((a, b) => {
          const dateDiff = a.date.localeCompare(b.date);
          if (dateDiff !== 0) return dateDiff;
          return a.time.localeCompare(b.time);
        });

        const newSessionsToCreate: Session[] = [];
        let infoIndex = 0;

        for (const newDate of newDates) {
          const times = [confirmScheduleChange.newTime];
          if (confirmScheduleChange.newDouble) {
            times.push(addOneHour(confirmScheduleChange.newTime));
          }

          for (const time of times) {
            const info = oldSessionsSorted[infoIndex] || oldSessionsSorted[oldSessionsSorted.length - 1] || { packageNumber: 1, notes: '' };
            infoIndex++;

            newSessionsToCreate.push({
              id: Math.random().toString(36).substr(2, 9),
              patientId: patient.id,
              date: newDate,
              time,
              type: confirmScheduleChange.newDouble ? SessionType.DUPLA : SessionType.SIMPLES,
              status: SessionStatus.AGENDADA,
              packageNumber: info.packageNumber,
              notes: info.notes || '',
              isFixedSchedule: true,
              source: 'fixed'
            });
          }
        }

        const oldIds = new Set(oldSessionsToRealign.map(s => s.id));
        updatedSessions = state.sessions.filter(s => !oldIds.has(s.id));
        updatedSessions.push(...newSessionsToCreate);
      }
    }

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const previousScheduleEnd = format(addDays(parseISO(todayStr), -1), 'yyyy-MM-dd');
    const previousScheduleStart = patient.fixedScheduleEffectiveFrom || patient.startDate || todayStr;
    const shouldKeepPreviousSchedule =
      !!confirmScheduleChange.oldDay &&
      !!confirmScheduleChange.oldTime &&
      previousScheduleStart <= previousScheduleEnd;

    const previousSchedule = shouldKeepPreviousSchedule
      ? [{
          fixedDay: confirmScheduleChange.oldDay,
          fixedTime: confirmScheduleChange.oldTime,
          doubleSession: confirmScheduleChange.oldDouble,
          effectiveFrom: previousScheduleStart,
          effectiveTo: previousScheduleEnd
        }]
      : [];

    const updatedPatient = {
      ...patient,
      ...editForm,
      fixedScheduleEffectiveFrom: todayStr,
      fixedScheduleHistory: [
        ...(patient.fixedScheduleHistory || []),
        ...previousSchedule
      ]
    } as Patient;

    const saved = await persistPatientUpdate(
      updatedPatient,
      { sessions: updatedSessions },
      realign
        ? 'Dados salvos e agenda futura realinhada com sucesso!'
        : 'Dados salvos com sucesso!',
    );

    if (saved) setConfirmScheduleChange(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'photoUrl' | 'reportPdfUrl' | 'opinionPdfUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (field === 'photoUrl') {
      try {
        validatePatientPhoto(file);
        setPendingPhotoFile(file);
        setPendingPhotoPreviewUrl(URL.createObjectURL(file));
      } catch (error) {
        clearPendingPhoto();
        e.currentTarget.value = '';
        showToast(getPatientPhotoErrorMessage(error), 'error');
      }
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setEditForm(prev => ({ ...prev, [field]: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateNewPackage = () => {
    setConfirmNewPackage(true);
  };

  const executeGenerateNewPackage = () => {
    const DAYS_MAP: Record<string, number> = { 'domingo': 0, 'segunda': 1, 'terça': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6 };
    const targetDay = DAYS_MAP[patient.fixedDay?.toLowerCase() || ''] ?? 1;

    const scheduledAndRealized = patientSessions;
    let startDate = new Date();

    if (scheduledAndRealized.length > 0) {
       startDate = addDays(parseISO(scheduledAndRealized[0].date), 7);
    } else {
       const currentDay = getDay(startDate);
       const add = (targetDay - currentDay + 7) % 7;
       startDate = addDays(startDate, add === 0 ? 7 : add);
    }

    // Force date to be the targetDay, just in case last session was off-schedule
    while(getDay(startDate) !== targetDay) {
        startDate = addDays(startDate, 1);
    }

    const generatedSessions: Session[] = [];
    for (let i = 0; i < 10; i++) {
       const times = [patient.fixedTime || '08:00'];
       if (patient.doubleSession) {
         times.push(addOneHour(patient.fixedTime || '08:00'));
       }
       for (const time of times) {
          const sessionNumberInCycle = (generatedSessions.length % 10) + 1;
          generatedSessions.push({
              id: Math.random().toString(36).substr(2, 9),
              patientId: patient.id,
              date: format(addDays(startDate, i * 7), 'yyyy-MM-dd'),
              time,
              type: patient.doubleSession ? SessionType.DUPLA : SessionType.SIMPLES,
              status: SessionStatus.AGENDADA,
              packageNumber: sessionNumberInCycle,
              isFixedSchedule: true,
              source: 'fixed'
          });
       }
    }

    onUpdate({ sessions: [...state.sessions, ...generatedSessions] });
    showToast(`Novo pacote gerado com ${generatedSessions.length} sessões.`, 'success');
    setConfirmNewPackage(false);
  };

  const applySessionStatus = async (
    sessionId: string,
    newStatus: SessionStatus,
    absenceConsumesPackage?: boolean,
  ) => {
    let finalStatus = newStatus;
    const session = state.sessions.find(s => s.id === sessionId);
    const consumesPackage = newStatus === SessionStatus.FALTA
      ? absenceConsumesPackage === true
      : newStatus === SessionStatus.REALIZADA || newStatus === SessionStatus.REPOSICAO;
    if (newStatus === SessionStatus.REALIZADA && session?.notes?.includes('Reposição referente')) {
        finalStatus = SessionStatus.REPOSICAO;
    }

    const decidedAt = new Date().toISOString();
    let updatedSessions = state.sessions.map(s => {
      if (s.id !== sessionId) return s;
      const { packageConsumptionDecidedAt, packageConsumptionDecidedBy, ...sessionWithoutDecisionAudit } = s;
      void packageConsumptionDecidedAt;
      void packageConsumptionDecidedBy;
      return {
        ...sessionWithoutDecisionAudit,
        status: finalStatus,
        consumesPackage,
        ...(finalStatus === SessionStatus.FALTA ? {
          packageConsumptionDecidedAt: decidedAt,
          packageConsumptionDecidedBy: currentUserName || 'Profissional',
        } : {}),
      };
    });
    let updatedRepositions = state.repositions;
    if ((finalStatus === SessionStatus.FALTA || finalStatus === SessionStatus.FALTA_PROF)) {
       const existingRepo = state.repositions.find(r => r.originalSessionId === sessionId);
       if (!existingRepo) {
           const newReposition: Reposition = {
               id: Math.random().toString(36).substr(2, 9),
               patientId: patient.id,
               originalSessionId: sessionId,
               status: 'Pendente'
           };
           updatedRepositions = [...state.repositions, newReposition];
       }
    } else {
        // Se mudou de FALTA para outro status, remover ou cancelar a reposição pendente
        updatedRepositions = updatedRepositions.filter(r => r.originalSessionId !== sessionId || r.status !== 'Pendente');
    }
    await onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
    showToast(`Status atualizado para ${finalStatus}.`);
  };

  const updateSessionStatus = (sessionId: string, newStatus: SessionStatus) => {
    if (newStatus === SessionStatus.FALTA) {
      setAbsenceDecisionModal({ sessionId, consumesPackage: null, isEditing: false });
      return;
    }
    void applySessionStatus(sessionId, newStatus);
  };

  const handleConfirmAbsenceDecision = async (consumesPackage: boolean) => {
    if (!absenceDecisionModal) return;
    const { sessionId, isEditing } = absenceDecisionModal;
    if (isEditing) {
      const decidedAt = new Date().toISOString();
      await onUpdate({
        sessions: state.sessions.map(item => item.id === sessionId
          ? {
              ...item,
              consumesPackage,
              packageConsumptionDecidedAt: decidedAt,
              packageConsumptionDecidedBy: currentUserName || 'Profissional',
            }
          : item),
      });
      showToast('Contabilização da falta atualizada.');
    } else {
      await applySessionStatus(sessionId, SessionStatus.FALTA, consumesPackage);
    }
    setAbsenceDecisionModal(null);
  };

  const handleRegisterPaymentClick = () => {
    const currentPackageNumber = packageFinancialSummary.hasNewPackageWithoutPayment
      && packageFinancialSummary.pendingGross <= 0
      ? packageFinancialSummary.packageNumber + 1
      : packageFinancialSummary.packageNumber;
    const currentPaid = currentPackageNumber === packageFinancialSummary.packageNumber
      ? packageFinancialSummary.paidGross
      : 0;
      
    setPaymentData({
      date: format(new Date(), 'yyyy-MM-dd'),
      installment: patient?.paymentModal === PaymentModal.PIX_FULL
        ? 'Pagamento integral'
        : currentPaid >= 500 ? '2ª parcela' : '1ª parcela',
      amount: patient?.paymentModal === PaymentModal.PIX_FULL
        ? Math.max(1000 - currentPaid, 0)
        : Math.min(500, Math.max(1000 - currentPaid, 0)),
      method: 'Pix',
      packageNumber: currentPackageNumber
    });
    setPaymentOperationKey(createPaymentOperationKey());
    setPaymentModalOpen(true);
  };

  const handleEditPaymentClick = async (payment: Payment) => {
    if (!isPaymentActive(payment) || paymentWriteLockRef.current) return;
    const reason = window.prompt('Informe a justificativa para cancelar este lançamento antes de registrar a correção:');
    if (!reason?.trim()) {
      showToast('A justificativa do cancelamento é obrigatória.', 'error');
      return;
    }
    paymentWriteLockRef.current = true;
    setIsSavingPayment(true);
    try {
      const prepared = preparePaymentVoid({
        payments: state.payments,
        expenses: state.expenses || [],
        paymentId: payment.id,
        reason,
        actor: currentUserName || 'Profissional',
        now: new Date().toISOString(),
      });
      await onUpdate({ payments: prepared.payments, expenses: prepared.expenses });
      showToast('Lançamento anterior cancelado. Registre agora o valor corrigido.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível cancelar o pagamento.', 'error');
      return;
    } finally {
      paymentWriteLockRef.current = false;
      setIsSavingPayment(false);
    }
    setPaymentData({
      date: payment.date,
      installment: payment.installment as any,
      amount: payment.amount,
      method: payment.method as any,
      packageNumber: payment.packageNumber || 1
    });
    setPaymentOperationKey(createPaymentOperationKey());
    setPaymentModalOpen(true);
  };

  const handleDeletePaymentClick = async (paymentId: string) => {
    if (paymentWriteLockRef.current) return;
    const reason = window.prompt('Informe a justificativa obrigatória para cancelar este pagamento:');
    if (!reason?.trim()) {
      showToast('A justificativa do cancelamento é obrigatória.', 'error');
      return;
    }
    paymentWriteLockRef.current = true;
    setIsSavingPayment(true);
    try {
      const prepared = preparePaymentVoid({
        payments: state.payments,
        expenses: state.expenses || [],
        paymentId,
        reason,
        actor: currentUserName || 'Profissional',
        now: new Date().toISOString(),
      });
      await onUpdate({ payments: prepared.payments, expenses: prepared.expenses });
      showToast('Pagamento e repasse cancelados, com histórico preservado.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível cancelar o pagamento.', 'error');
    } finally {
      paymentWriteLockRef.current = false;
      setIsSavingPayment(false);
    }
  };

  const handleSavePayment = async () => {
    if (paymentWriteLockRef.current) return;
    paymentWriteLockRef.current = true;
    setIsSavingPayment(true);
    try {
      const prepared = preparePaymentCreation({
        patient,
        sessions: state.sessions,
        payments: state.payments,
        expenses: state.expenses || [],
        input: {
          patientId: patient.id,
          amount: paymentData.amount,
          date: paymentData.date,
          installment: paymentData.installment,
          method: paymentData.method,
          packageNumber: paymentData.packageNumber,
        },
        operationKey: paymentOperationKey || createPaymentOperationKey(),
        actor: currentUserName || 'Profissional',
        now: new Date().toISOString(),
      });
      await onUpdate({ payments: prepared.payments, expenses: prepared.expenses });
      showToast('Pagamento registrado com sucesso!', 'success');
      setPaymentModalOpen(false);
      setPaymentOperationKey('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível registrar o pagamento.', 'error');
    } finally {
      paymentWriteLockRef.current = false;
      setIsSavingPayment(false);
    }
  };

  const handleScheduleReposition = () => {
    if (!repositionModalSession) return;
    
    const newSession: Session = {
      id: Math.random().toString(36).substr(2, 9),
      patientId: patient.id,
      date: repoDate,
      time: repoTime,
      type: repositionModalSession.type,
      status: SessionStatus.AGENDADA,
      notes: `Reposição referente à falta do dia ${safeFormatDate(repositionModalSession.date, 'dd/MM/yyyy')}`,
      packageNumber: repositionModalSession.packageNumber
    };

    let updatedRepositions = [...state.repositions];
    const existingRepoIndex = updatedRepositions.findIndex(r => r.originalSessionId === repositionModalSession.id);
    if (existingRepoIndex >= 0) {
        updatedRepositions[existingRepoIndex] = { ...updatedRepositions[existingRepoIndex], status: 'Agendada' };
    } else {
        updatedRepositions.push({
            id: Math.random().toString(36).substr(2, 9),
            patientId: patient.id,
            originalSessionId: repositionModalSession.id,
            status: 'Agendada'
        });
    }

    onUpdate({
      sessions: [...state.sessions, newSession],
      repositions: updatedRepositions
    });

    showToast('Reposição agendada com sucesso!', 'success');
    setRepositionModalSession(null);
  };

  // Group realized sessions into packages of up to 10 sessions
  let packageHistory = realizedSessionsChronological.reduce((acc, session, index) => {
    const pkgIndex = Math.floor(index / 10); // 0-based package index
    if (!acc[pkgIndex]) {
      acc[pkgIndex] = {
        number: pkgIndex + 1,
        sessions: [],
        startDate: session.date,
        endDate: session.date,
        count: 0,
        completed: false,
        isCurrent: false,
      };
    }
    const pkg = acc[pkgIndex];
    pkg.sessions.push(session);
    pkg.count = pkg.sessions.length;
    pkg.endDate = session.date; // update to latest session date in the package
    // Mark completed if exactly 10 sessions
    pkg.completed = pkg.count === 10;
    return acc;
  }, [] as any);

  // Remove any empty packages (should not occur) and set isCurrent for the last incomplete package
  packageHistory = packageHistory.filter(pkg => pkg.count > 0);
  const lastPkg = packageHistory[packageHistory.length - 1];
  if (lastPkg && !lastPkg.completed) {
    lastPkg.isCurrent = true;
  }

  // Determine current package number for in-progress display (number of full packages + 1 if current exists)
  const currentPkgNumber = packageHistory.length > 0 ? packageHistory[packageHistory.length - 1].number : 0;
  const currentPkgProgress = realizedInPackage;
  const nextSession = patientSessions
    .filter(s => s.status === SessionStatus.AGENDADA && s.date >= format(new Date(), 'yyyy-MM-dd'))
    .sort((a,b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
  const pendingRepositionsCount = state.repositions.filter(r => r.patientId === patient.id && r.status === 'Pendente').length;
  const financialStatus = isLate
    ? { label: 'Atraso', detail: `${daysLate} dias`, tone: 'red' }
    : patient.paymentModal === PaymentModal.PARCELADO && realizedInPackage >= 4 && packageFinancialSummary.pendingGross > 0
      ? { label: 'Cobrar em breve', detail: '2ª parcela', tone: 'orange' }
      : { label: packageFinancialSummary.status, detail: formatCurrency(packageFinancialSummary.paidGross), tone: 'green' };
  const packageStatus = realizedInPackage >= 8
    ? { label: 'Renovar', detail: `${realizedInPackage}/10`, tone: 'orange' }
    : realizedInPackage === 0
      ? { label: 'Novo', detail: '0/10', tone: 'blue' }
      : { label: 'Em andamento', detail: `${realizedInPackage}/10`, tone: 'green' };
  const whatsappStatus = patient.whatsapp?.trim()
    ? { label: 'WhatsApp OK', detail: patient.whatsapp, tone: 'green' }
    : { label: 'Sem WhatsApp', detail: 'Cadastro incompleto', tone: 'red' };
  const documentItems = [
    { label: 'Foto', ok: hasPatientPhoto(patient) },
    { label: 'Relatório', ok: !!patient.reportPdfUrl },
    { label: 'Parecer', ok: !!patient.opinionPdfUrl },
    { label: 'Escola', ok: !!patient.school },
    { label: 'Médico', ok: !!patient.doctorName },
  ];
  const completedDocuments = documentItems.filter(item => item.ok).length;
  const documentStatus = completedDocuments === documentItems.length
    ? { label: 'Completo', detail: `${completedDocuments}/${documentItems.length}`, tone: 'green' }
    : { label: 'Pendente', detail: `${completedDocuments}/${documentItems.length}`, tone: completedDocuments >= 3 ? 'orange' : 'red' };
  const completionItems = [
    !!patient.name,
    !!patient.birthDate,
    !!patient.guardianName,
    !!patient.whatsapp,
    !!patient.fixedDay,
    !!patient.fixedTime,
    !!patient.startDate,
    !!patient.school,
    !!patient.grade,
    !!patient.shift,
    !!patient.doctorName,
    !!patient.medication,
    !!patient.reportPdfUrl,
    !!patient.opinionPdfUrl,
    hasPatientPhoto(patient),
    !!patient.anamnese?.complaint,
    !!patient.anamnese?.diagnoses,
    !!patient.clinicalNotes,
  ];
  const completionScore = Math.round((completionItems.filter(Boolean).length / completionItems.length) * 100);
  const lastEvolution = patientEvolutions[0];
  const missingDocuments = documentItems.filter(item => !item.ok).map(item => item.label);

  const statusToneClass = (tone: string) => {
    switch (tone) {
      case 'green':
        return 'bg-status-green-bg text-status-green-text border-status-green-text/20';
      case 'orange':
        return 'bg-status-orange-bg text-status-orange-text border-status-orange-text/20';
      case 'red':
        return 'bg-status-red-bg text-status-red-text border-status-red-text/20';
      default:
        return 'bg-status-blue-bg text-status-blue-text border-status-blue-text/20';
    }
  };

  const confirmSessionMessage = `Olá ${patient.guardianName}! Confirmando a sessão de ${patient.name} em ${format(new Date(), 'dd/MM')} às ${patient.fixedTime}. Qualquer dúvida estou à disposição. Fábio Denarde.`;
  const paymentMessage = `Olá ${patient.guardianName}! Passando para lembrar que a 2ª parcela do pacote de ${patient.name} (R$500,00) será na próxima sessão. Qualquer dúvida estou à disposição. Fábio Denarde.`;
  const renovationMessage = `Olá ${patient.guardianName}! O pacote de sessões de ${patient.name} está chegando ao fim. Gostaria de conversar sobre a continuidade do atendimento? Fábio Denarde.`;

  const tabs = [
    { id: 'dados', label: 'Cadastro', fullLabel: 'Dados Cadastrais', icon: Users },
    { id: 'sessoes', label: 'Sessões', fullLabel: 'Sessões', icon: Calendar },
    { id: 'pacotes', label: 'Pacotes', fullLabel: 'Histórico de Pacotes', icon: RefreshCw },
    { id: 'financeiro', label: 'Financeiro', fullLabel: 'Financeiro', icon: DollarSign },
    { id: 'anotacoes', label: 'Anotações', fullLabel: 'Anotações Gerais', icon: Edit3 },
    { id: 'evolucao', label: 'Evolução', fullLabel: 'Evolução Clínica', icon: FileText },
  ];

  const updateNotes = (notes: string) => {
    const updatedPatients = state.patients.map(p => p.id === patient.id ? { ...p, clinicalNotes: notes } : p);
    onUpdate({ patients: updatedPatients });
  };

  return (
    <>
      {absenceDecisionModal && (
        <PackageConsumptionDecisionModal
          isOpen={true}
          value={absenceDecisionModal.consumesPackage}
          onChange={consumesPackage => setAbsenceDecisionModal(current => current ? { ...current, consumesPackage } : current)}
          onClose={() => setAbsenceDecisionModal(null)}
          onConfirm={handleConfirmAbsenceDecision}
          confirmNonConsumption={absenceDecisionModal.isEditing}
          title={absenceDecisionModal.isEditing ? 'Alterar contabilização da falta' : 'Registrar falta'}
        />
      )}
      <Modal
        isOpen={isOpen}
        onClose={requestClosePatientModal}
        title={patient.name}
        width="max-w-5xl"
      >
        <div className="flex flex-col gap-6">
          {/* Resumo inteligente compacto */}
          <section className="overflow-hidden rounded-xl border border-clinic-border bg-clinic-surface shadow-sm">
            <div className="p-3 md:p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <PatientPhoto
                    patient={patient}
                    alt={patient.name}
                    onClick={hasPatientPhoto(patient) ? () => setIsPhotoExpanded(true) : undefined}
                    className="h-16 w-16 shrink-0 cursor-pointer rounded-xl border border-clinic-border object-cover shadow-sm transition hover:opacity-90"
                    fallbackClassName="h-16 w-16 shrink-0 rounded-xl bg-white border border-clinic-border flex items-center justify-center text-2xl font-bold text-clinic-primary shadow-sm"
                    fallbackText={patient.name.charAt(0)}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-xl font-black text-clinic-text">{patient.name}</h3>
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest',
                        patient.status === 'Ativo'
                          ? 'border-status-green-text/20 bg-status-green-bg text-status-green-text'
                          : 'border-status-red-text/20 bg-status-red-bg text-status-red-text'
                      )}>
                        {patient.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-clinic-text-muted">
                      {calculateAge(patient.birthDate)} anos • Responsável: {patient.guardianName || 'não informado'}
                    </p>
                    <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">
                      {patient.fixedDay || 'sem dia'} às {patient.fixedTime || '--:--'} {patient.doubleSession ? '• sessão dupla' : ''}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 xl:min-w-[650px]">
                  {[
                    {
                      icon: CheckCircle,
                      title: 'Status',
                      label: patient.status,
                      detail: 'Atendente',
                      tone: patient.status === 'Ativo' ? 'green' : 'red',
                    },
                    { icon: RefreshCw, title: 'Pacote', ...packageStatus },
                    { icon: DollarSign, title: 'Financeiro', ...financialStatus },
                    { icon: MessageCircle, title: 'WhatsApp', ...whatsappStatus },
                    { icon: FileText, title: 'Documentos', ...documentStatus },
                  ].map(item => (
                    <div
                      key={item.title}
                      className={cn(
                        'min-w-0 rounded-lg border px-2.5 py-2',
                        statusToneClass(item.tone)
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <item.icon size={12} className="shrink-0" />
                        <span className="truncate text-[8px] font-black uppercase tracking-widest">{item.title}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-black leading-tight">{item.label}</p>
                      <p className="truncate text-[9px] font-bold opacity-80">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-clinic-border/70 bg-clinic-bg/55 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-clinic-text-faint">Completude</p>
                    <span className="text-sm font-black text-clinic-text">{completionScore}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-clinic-border">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        completionScore >= 80
                          ? 'bg-status-green-text'
                          : completionScore >= 55
                            ? 'bg-status-orange-text'
                            : 'bg-status-red-text'
                      )}
                      style={{ width: `${completionScore}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-clinic-border/70 bg-clinic-bg/55 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-clinic-text-faint">Próxima sessão</p>
                  <p className="mt-1 truncate text-xs font-black text-clinic-text">
                    {nextSession ? `${safeFormatDate(nextSession.date, 'dd/MM')} às ${nextSession.time}` : 'Nenhuma agendada'}
                  </p>
                </div>

                <div className="rounded-lg border border-clinic-border/70 bg-clinic-bg/55 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-clinic-text-faint">Reposições</p>
                  <p className={cn(
                    'mt-1 truncate text-xs font-black',
                    pendingRepositionsCount > 0 ? 'text-status-orange-text' : 'text-clinic-text'
                  )}>
                    {pendingRepositionsCount > 0 ? `${pendingRepositionsCount} pendente(s)` : 'Sem pendências'}
                  </p>
                </div>

                <div className="rounded-lg border border-clinic-border/70 bg-clinic-bg/55 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-clinic-text-faint">Última evolução</p>
                  <p className="mt-1 truncate text-xs font-black text-clinic-text">
                    {lastEvolution ? safeFormatDate(lastEvolution.date, 'dd/MM/yyyy') : 'Sem registro'}
                  </p>
                </div>
              </div>

              {(missingDocuments.length > 0 || isLate || realizedInPackage >= 8 || !patient.whatsapp?.trim()) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {isLate && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-status-red-text/20 bg-status-red-bg px-2.5 py-1.5 text-[10px] font-bold text-status-red-text">
                      <AlertTriangle size={12} /> Parcela atrasada há {daysLate} dia(s)
                    </span>
                  )}
                  {realizedInPackage >= 8 && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-status-orange-text/20 bg-status-orange-bg px-2.5 py-1.5 text-[10px] font-bold text-status-orange-text">
                      <RefreshCw size={12} /> Renovação do pacote: {realizedInPackage}/10
                    </span>
                  )}
                  {!patient.whatsapp?.trim() && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-status-red-text/20 bg-status-red-bg px-2.5 py-1.5 text-[10px] font-bold text-status-red-text">
                      <MessageCircle size={12} /> WhatsApp não informado
                    </span>
                  )}
                  {missingDocuments.length > 0 && (
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-clinic-border bg-clinic-bg px-2.5 py-1.5 text-[10px] font-bold text-clinic-text-muted">
                      <FileText size={12} className="shrink-0" />
                      <span className="truncate">Pendências: {missingDocuments.join(', ')}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Ações rápidas */}
          <div className="flex flex-col gap-2 rounded-xl border border-clinic-border bg-clinic-bg/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-clinic-text-faint">Ações rápidas</p>
              <p className="truncate text-[10px] font-semibold text-clinic-text-muted">
                Atalhos manuais preservam o WhatsApp cadastrado e não disparam mensagens automáticas.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <a
                href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(confirmSessionMessage)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-status-green-bg px-3 py-2 text-[9px] font-black uppercase tracking-wide text-status-green-text transition hover:scale-[1.02]"
              >
                <MessageCircle size={13} /> Confirmar sessão
              </a>

              {onNavigateToPatientGallery && (
                <button
                  type="button"
                  onClick={() => onNavigateToPatientGallery(patient.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-status-blue-bg px-3 py-2 text-[9px] font-black uppercase tracking-wide text-status-blue-text transition hover:scale-[1.02]"
                  title="Abrir a Galeria de Atividades deste atendente"
                >
                  <Images size={13} /> Galeria de Atividades
                </button>
              )}

              {patient.paymentModal === PaymentModal.PARCELADO && realizedInPackage >= 4 && (
                <a
                  href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(paymentMessage)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-status-orange-bg px-3 py-2 text-[9px] font-black uppercase tracking-wide text-status-orange-text transition hover:scale-[1.02]"
                >
                  <DollarSign size={13} /> Lembrar pagamento
                </a>
              )}

              {realizedInPackage >= 8 && (
                <>
                  <a
                    href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(renovationMessage)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-status-blue-bg px-3 py-2 text-[9px] font-black uppercase tracking-wide text-status-blue-text transition hover:scale-[1.02]"
                    title="Enviar mensagem WhatsApp lembrando da renovação"
                  >
                    <MessageCircle size={13} /> Lembrar renovação
                  </a>
                  <button
                    type="button"
                    onClick={handleGenerateNewPackage}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-clinic-text px-3 py-2 text-[9px] font-black uppercase tracking-wide text-white transition hover:scale-[1.02]"
                    title="Adicionar 10 novas sessões ao calendário"
                  >
                    <Plus size={13} /> Novo pacote
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Navegação do prontuário */}
          <nav className="overflow-hidden rounded-xl border border-clinic-border bg-white shadow-sm">
            <div className="p-2 md:hidden">
              <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-clinic-text-faint">
                Área do prontuário
              </label>
              <select
                value={activeSubTab}
                onChange={event => setActiveSubTab(event.target.value)}
                className="w-full rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2.5 text-sm font-bold text-clinic-text outline-none focus:border-clinic-primary"
              >
                {tabs.map(tab => (
                  <option key={tab.id} value={tab.id}>{tab.fullLabel}</option>
                ))}
              </select>
            </div>

            <div className="hidden grid-cols-6 divide-x divide-clinic-border md:grid">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.fullLabel}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={cn(
                    'flex min-w-0 flex-col items-center justify-center gap-1 px-1.5 py-2.5 text-center transition-colors',
                    activeSubTab === tab.id
                      ? 'bg-clinic-primary text-white'
                      : 'bg-white text-clinic-text-faint hover:bg-clinic-primary/5 hover:text-clinic-primary'
                  )}
                >
                  <tab.icon size={14} className="shrink-0" />
                  <span className="w-full truncate text-[9px] font-black uppercase tracking-wide">{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="mt-4">
            {activeSubTab === 'dados' && (
              <div className="animate-in fade-in slide-in-from-top-2">
                <div className="mb-4 space-y-3">
                  {patient.lastExternalRegistrationUpdate && (
                    <div className="bg-status-blue-bg border border-status-blue-text/20 rounded-xl p-3 text-sm text-status-blue-text font-bold flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <span>
                        Cadastro atualizado via formulário do responsável em {safeFormatDate(patient.lastExternalRegistrationUpdate, 'dd/MM/yyyy HH:mm')}.
                      </span>
                      {latestExternalHistory && (
                        <span className="text-[10px] uppercase tracking-wider">
                          Campos: {latestExternalHistory.changedFields.map(getFieldLabelForPatient).join(', ') || 'sem alteração'}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="bg-clinic-bg/70 border border-clinic-border rounded-xl p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-clinic-text-faint">Formulário externo</p>
                      <p className="text-xs text-clinic-text-muted font-medium">
                        Gere o link de conferência deste cadastro e envie manualmente pelo WhatsApp. Nenhuma mensagem automática será disparada.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={generateExternalRegistrationLink}
                        className="px-3 py-2 bg-clinic-primary text-white rounded-lg text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-2"
                      >
                        <LinkIcon size={14} /> Gerar link para atualizar este cadastro
                      </button>
                    </div>
                  </div>

                  {lastGeneratedExternalLink && (
                    <div className="bg-white border border-clinic-border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <input
                        readOnly
                        value={lastGeneratedExternalLink}
                        className="flex-1 px-3 py-2 bg-clinic-bg rounded-lg border border-clinic-border text-xs text-clinic-text"
                      />
                      <button
                        type="button"
                        onClick={() => copyExternalRegistrationLink(lastGeneratedExternalLink)}
                        className="px-3 py-2 bg-clinic-header text-white rounded-lg text-[10px] font-black uppercase tracking-wide flex items-center justify-center gap-2"
                      >
                        <ClipboardCopy size={14} /> Copiar
                      </button>
                    </div>
                  )}
                </div>
                <section className="mb-5 rounded-2xl border border-clinic-border bg-clinic-bg/45 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-clinic-primary">Solicitações do Portal do Responsável</p>
                      <p className="text-xs text-clinic-text-muted">O cadastro oficial só é alterado depois da aprovação profissional.</p>
                    </div>
                    {profileRequestsLoading && <span className="text-xs font-bold text-clinic-text-muted">Carregando solicitações...</span>}
                  </div>

                  {!profileRequestsLoading && profileChangeRequests.length === 0 && (
                    <p className="mt-3 rounded-xl border border-dashed border-clinic-border bg-white/70 p-3 text-xs text-clinic-text-muted">Nenhuma solicitação cadastral enviada pelo responsável.</p>
                  )}

                  {profileChangeRequests.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {profileChangeRequests.slice(0, 5).map(request => {
                        const statusLabel = request.status === 'pending' ? 'Pendente' : request.status === 'approved' ? 'Aprovada' : 'Recusada';
                        const statusClassName = request.status === 'pending'
                          ? 'bg-status-orange-bg text-status-orange-text'
                          : request.status === 'approved'
                            ? 'bg-status-green-bg text-status-green-text'
                            : 'bg-status-red-bg text-status-red-text';
                        return (
                          <article key={request.id} className="rounded-xl border border-clinic-border bg-white p-4 shadow-sm">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-black text-clinic-text">Solicitação de {request.responsibleName || 'Responsável'}</p>
                                <p className="text-[10px] font-bold text-clinic-text-faint">
                                  {request.createdAt ? safeFormatDate(request.createdAt, 'dd/MM/yyyy HH:mm') : 'Data não informada'}
                                </p>
                              </div>
                              <span className={`w-fit rounded-full px-3 py-1 text-[10px] font-black uppercase ${statusClassName}`}>{statusLabel}</span>
                            </div>

                            <div className="mt-3 overflow-hidden rounded-lg border border-clinic-border">
                              {request.changedFields.map(field => (
                                <div key={field} className="grid gap-2 border-b border-clinic-border/60 p-3 last:border-b-0 md:grid-cols-[minmax(150px,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
                                  <span className="text-[10px] font-black uppercase text-clinic-text-faint">{getFieldLabelForPatient(field)}</span>
                                  <div>
                                    <span className="block text-[9px] font-black uppercase text-clinic-text-faint">Dado atual</span>
                                    <span className="whitespace-pre-wrap text-xs font-semibold text-clinic-text-muted">{formatPatientRegistrationValue(field, request.before[field])}</span>
                                  </div>
                                  <div>
                                    <span className="block text-[9px] font-black uppercase text-clinic-primary">Dado solicitado</span>
                                    <span className="whitespace-pre-wrap text-xs font-bold text-clinic-text">{formatPatientRegistrationValue(field, request.after[field])}</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {request.rejectionReason && (
                              <p className="mt-3 rounded-lg bg-status-red-bg p-3 text-xs font-semibold text-status-red-text">Motivo da recusa: {request.rejectionReason}</p>
                            )}

                            {request.status === 'pending' && (
                              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                                <button type="button" onClick={() => void handleReviewProfileChangeRequest(request, 'rejected')} disabled={Boolean(profileRequestReviewingId)} className="rounded-lg border border-status-red-text/30 px-4 py-2 text-xs font-black uppercase text-status-red-text disabled:opacity-50">
                                  {profileRequestReviewingId === request.id ? 'Processando...' : 'Recusar'}
                                </button>
                                <button type="button" onClick={() => void handleReviewProfileChangeRequest(request, 'approved')} disabled={Boolean(profileRequestReviewingId)} className="rounded-lg bg-status-green-text px-4 py-2 text-xs font-black uppercase text-white disabled:opacity-50">
                                  {profileRequestReviewingId === request.id ? 'Processando...' : 'Aprovar alterações'}
                                </button>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>

                {!isEditingData ? (
                  <div className="space-y-5">
                    <div className="flex flex-col gap-4 rounded-2xl border border-clinic-border bg-white/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-4">
                        <PatientPhoto
                          patient={patient}
                          alt={patient.fullName || patient.name}
                          onClick={hasPatientPhoto(patient) ? () => setIsPhotoExpanded(true) : undefined}
                          className="h-16 w-16 cursor-pointer rounded-full border border-clinic-border/50 object-cover shadow-sm transition hover:opacity-80"
                          fallbackClassName="h-16 w-16 rounded-full border border-clinic-border/50 bg-clinic-bg flex items-center justify-center text-xl font-bold text-clinic-text-faint shadow-sm"
                          fallbackText={patient.name.charAt(0)}
                        />
                        <div>
                          <p className="text-lg font-black leading-tight text-clinic-text">{patient.fullName || patient.name}</p>
                          <p className="text-xs font-semibold text-clinic-text-muted">Chamado de {patient.name} • {calculateAge(patient.birthDate)} anos</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => { setEditForm(getPatientEditDefaults(patient)); setIsEditingData(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-clinic-primary px-4 py-3 text-xs font-black uppercase text-white">
                        <Edit3 size={14} /> Editar cadastro
                      </button>
                    </div>

                    {isPhotoExpanded && hasPatientPhoto(patient) && (
                      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setIsPhotoExpanded(false)}>
                        <PatientPhoto
                          patient={patient}
                          alt={`Foto ampliada de ${patient.fullName || patient.name}`}
                          className="max-h-full max-w-full cursor-pointer rounded-2xl object-cover shadow-2xl animate-in zoom-in-95"
                          fallbackClassName="hidden"
                        />
                        <button type="button" className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/80" aria-label="Fechar foto ampliada">
                          <X size={24} />
                        </button>
                      </div>
                    )}

                    <PatientRegistrationSummary value={{ ...patient, fullName: patient.fullName || patient.name }} />

                    <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
                      <h4 className="mb-3 border-b border-clinic-border pb-2 text-sm font-black text-clinic-text">Atendimento e pacote</h4>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {[
                          ['Dia e horário fixos', `${patient.fixedDay || 'Não informado'} — ${patient.fixedTime || 'Não informado'}`],
                          ['Início do acompanhamento', safeFormatDate(patient.startDate, 'dd/MM/yyyy')],
                          ['Modalidade', patient.paymentModal],
                          ['Status', patient.status],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-xl border border-clinic-border bg-clinic-bg/60 p-3">
                            <span className="block text-[9px] font-black uppercase tracking-wide text-clinic-text-faint">{label}</span>
                            <span className="mt-1 block text-xs font-bold text-clinic-text">{value}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
                      <h4 className="mb-3 border-b border-clinic-border pb-2 text-sm font-black text-clinic-text">Documentos do Atendente</h4>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <p className="text-[10px] font-black uppercase text-clinic-text-faint">Relatórios da clínica</p>
                          {patient.reportPdfUrl ? (
                            <a href={patient.reportPdfUrl} download="Relatorio.pdf" className="flex items-center justify-center gap-2 rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2 text-xs font-bold text-clinic-primary"><FileText size={14} /> Ver relatório</a>
                          ) : <p className="text-xs italic text-clinic-text-faint">Sem relatório anexado.</p>}
                          {patient.opinionPdfUrl ? (
                            <a href={patient.opinionPdfUrl} download="Parecer.pdf" className="flex items-center justify-center gap-2 rounded-lg border border-clinic-border bg-clinic-bg px-3 py-2 text-xs font-bold text-clinic-primary"><FileText size={14} /> Ver parecer</a>
                          ) : <p className="text-xs italic text-clinic-text-faint">Sem parecer anexado.</p>}
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-black uppercase text-clinic-text-faint">Enviados pelo responsável</p>
                            {!!patient.responsibleDocuments?.length && <span className="rounded-full bg-status-blue-bg px-2 py-0.5 text-[9px] font-black text-status-blue-text">{patient.responsibleDocuments.length}</span>}
                          </div>
                          {!patient.responsibleDocuments?.length ? (
                            <p className="text-xs italic text-clinic-text-faint">Nenhum documento enviado pelo portal.</p>
                          ) : (
                            <div className="space-y-2">
                              {[...patient.responsibleDocuments].reverse().map(document => (
                                <article key={document.id} className="rounded-lg border border-clinic-border bg-clinic-bg/60 p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate text-xs font-black text-clinic-text">{document.category || 'Documento'}</p>
                                      <p className="truncate text-[10px] text-clinic-text-muted">{document.fileName}</p>
                                      <p className="mt-1 text-[9px] font-bold text-clinic-text-faint">{formatPortalDocumentSize(document.sizeBytes)} • {document.uploadedByName || 'Responsável'}</p>
                                    </div>
                                    <button type="button" onClick={() => void downloadResponsibleDocument(document.id, document.fileName)} className="shrink-0 rounded-lg bg-white p-2 text-clinic-primary shadow-sm" title={`Baixar ${document.fileName}`}><FileText size={14} /></button>
                                  </div>
                                  {document.note && <p className="mt-2 whitespace-pre-wrap text-[10px] text-clinic-text-muted">{document.note}</p>}
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
                      <h4 className="mb-3 border-b border-clinic-border pb-2 text-sm font-black text-clinic-text">Histórico de pacotes</h4>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                        {packageHistory.filter(pkg => pkg.completed).length > 0 ? packageHistory.filter(pkg => pkg.completed).map(pkg => (
                          <div key={pkg.number} className="flex items-center justify-between rounded-lg border border-clinic-border/50 bg-clinic-bg/30 px-3 py-2 text-sm shadow-sm">
                            <span className="text-xs font-bold uppercase tracking-wide text-clinic-text">Pacote {pkg.number}</span>
                            <span className="rounded bg-white/50 px-2 py-0.5 text-[10px] font-medium text-clinic-text-muted">{safeFormatDate(pkg.startDate, 'dd/MM')} a {safeFormatDate(pkg.endDate, 'dd/MM/yy')}</span>
                          </div>
                        )) : <p className="col-span-full py-2 text-[10px] font-bold uppercase tracking-widest text-clinic-text-faint">Nenhum pacote anterior finalizado</p>}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-4 bg-clinic-bg/30 p-4 shrink-0 border border-clinic-border rounded-xl">
                    <div className="flex items-center justify-between border-b border-clinic-border pb-4 mb-4">
                      <h5 className="text-lg font-bold text-clinic-text flex items-center gap-2">
                        <Edit3 size={18} className="text-clinic-primary" />
                        Editar Dados
                      </h5>
                      <div className="flex gap-2">
                        <button
                          onClick={cancelEditingData}
                          className="text-clinic-text-faint hover:text-clinic-text text-xs uppercase font-bold px-3 py-1.5 transition-colors"
                        >
                          {isSavingData ? 'Cancelar envio' : 'Cancelar'}
                        </button>
                        <button
                          onClick={handleSavePatientData}
                          disabled={isSavingData}
                          className="bg-clinic-primary text-white text-xs uppercase font-bold px-4 py-1.5 rounded-lg hover:bg-clinic-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingData ? 'Salvando...' : 'Salvar Alterações'}
                        </button>
                      </div>
                    </div>
                    
                    <PatientRegistrationFields
                      value={editForm}
                      onChange={patch => setEditForm(current => ({ ...current, ...patch }))}
                      disabled={isSavingData}
                      requiredCore
                    />

                    <div className="grid grid-cols-1 gap-5 pt-2 lg:grid-cols-2">
                      <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
                        <h4 className="mb-4 flex items-center gap-2 border-b border-clinic-border pb-2 text-base font-black text-clinic-text">
                          <Images size={17} className="text-clinic-primary" /> Arquivos e autorizações
                        </h4>
                        <div className="space-y-4">
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Foto do Atendente</span>
                            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={isSavingData} onChange={event => handleFileUpload(event, 'photoUrl')} className="block w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2 text-sm text-clinic-text-muted file:mr-4 file:rounded-full file:border-0 file:bg-clinic-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60" />
                          </label>
                          {(pendingPhotoPreviewUrl || hasPatientPhoto(editForm)) && (
                            <div className="flex items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg/50 p-3">
                              {pendingPhotoPreviewUrl ? (
                                <img src={pendingPhotoPreviewUrl} alt="Prévia da foto do atendente" className="h-14 w-14 rounded-full border border-clinic-border object-cover" />
                              ) : (
                                <PatientPhoto
                                  patient={{ name: editForm.name || patient.name, photoUrl: editForm.photoUrl, photoDriveFileId: editForm.photoDriveFileId }}
                                  alt="Foto atual do atendente"
                                  className="h-14 w-14 rounded-full border border-clinic-border object-cover"
                                  fallbackClassName="h-14 w-14 rounded-full border border-clinic-border bg-clinic-bg flex items-center justify-center font-bold text-clinic-primary"
                                />
                              )}
                              <p className="text-xs text-clinic-text-muted">{pendingPhotoPreviewUrl ? 'Nova foto selecionada. O envio ao Google Drive será concluído ao salvar.' : 'Foto atual salva de forma privada no Google Drive.'}</p>
                            </div>
                          )}
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Relatório em PDF</span>
                            <input type="file" accept="application/pdf" disabled={isSavingData} onChange={event => handleFileUpload(event, 'reportPdfUrl')} className="block w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2 text-sm text-clinic-text-muted file:mr-4 file:rounded-full file:border-0 file:bg-clinic-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Parecer em PDF</span>
                            <input type="file" accept="application/pdf" disabled={isSavingData} onChange={event => handleFileUpload(event, 'opinionPdfUrl')} className="block w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-2 text-sm text-clinic-text-muted file:mr-4 file:rounded-full file:border-0 file:bg-clinic-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60" />
                          </label>

                          <div data-activity-authorization className="space-y-3 rounded-xl border border-clinic-border bg-clinic-bg/60 p-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-clinic-text-faint">Autorização de imagem e mídia</p>
                              <p className="text-xs text-clinic-text-muted">Controle separado para registro interno e compartilhamento com o responsável.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <label className="text-[10px] font-bold uppercase text-clinic-text-faint">Registro interno
                                <select value={editForm.activityMediaAuthorization?.internalRecordingStatus || 'pending'} onChange={event => setEditForm(current => ({ ...current, activityMediaAuthorization: { ...(current.activityMediaAuthorization || getDefaultActivityAuthorization()), internalRecordingStatus: event.target.value as any } }))} disabled={isSavingData} className="mt-1 w-full rounded-lg border border-clinic-border bg-white p-2.5 text-sm normal-case">
                                  <option value="pending">Autorização pendente</option>
                                  <option value="authorized">Autorizado</option>
                                  <option value="not_authorized">Não autorizado</option>
                                </select>
                              </label>
                              <label className="text-[10px] font-bold uppercase text-clinic-text-faint">Compartilhar com responsável
                                <select value={editForm.activityMediaAuthorization?.guardianSharingStatus || 'pending'} onChange={event => setEditForm(current => ({ ...current, activityMediaAuthorization: { ...(current.activityMediaAuthorization || getDefaultActivityAuthorization()), guardianSharingStatus: event.target.value as any } }))} disabled={isSavingData} className="mt-1 w-full rounded-lg border border-clinic-border bg-white p-2.5 text-sm normal-case">
                                  <option value="pending">Autorização pendente</option>
                                  <option value="authorized">Autorizado</option>
                                  <option value="not_authorized">Não autorizado</option>
                                </select>
                              </label>
                            </div>
                            <textarea value={editForm.activityMediaAuthorization?.notes || ''} onChange={event => setEditForm(current => ({ ...current, activityMediaAuthorization: { ...(current.activityMediaAuthorization || getDefaultActivityAuthorization()), notes: event.target.value } }))} disabled={isSavingData} placeholder="Observação da autorização (opcional)" className="w-full rounded-lg border border-clinic-border bg-white p-2.5 text-sm" />
                          </div>
                        </div>
                      </section>

                      <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
                        <h4 className="mb-4 flex items-center gap-2 border-b border-clinic-border pb-2 text-base font-black text-clinic-text">
                          <Clock size={17} className="text-clinic-primary" /> Configuração do pacote e status
                        </h4>
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <label>
                              <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Dia fixo</span>
                              <select value={editForm.fixedDay || ''} onChange={event => setEditForm(current => ({ ...current, fixedDay: event.target.value }))} disabled={isSavingData} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary">
                                {AVAILABLE_DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                              </select>
                            </label>
                            <label>
                              <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Horário fixo</span>
                              <select value={AVAILABLE_TIMES.includes(editForm.fixedTime || '') ? editForm.fixedTime : 'custom'} onChange={event => setEditForm(current => ({ ...current, fixedTime: event.target.value === 'custom' ? '17:30' : event.target.value }))} disabled={isSavingData} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary">
                                {AVAILABLE_TIMES.map(time => <option key={time} value={time}>{time}</option>)}
                                <option value="custom">Outro horário...</option>
                              </select>
                              {(!editForm.fixedTime || !AVAILABLE_TIMES.includes(editForm.fixedTime)) && (
                                <input type="text" placeholder="Ex.: 17:30" value={editForm.fixedTime || ''} onChange={event => setEditForm(current => ({ ...current, fixedTime: event.target.value }))} disabled={isSavingData} className="mt-2 w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" />
                              )}
                            </label>
                          </div>
                          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg p-3">
                            <input type="checkbox" checked={Boolean(editForm.doubleSession)} onChange={event => setEditForm(current => ({ ...current, doubleSession: event.target.checked }))} disabled={isSavingData} className="h-4 w-4 accent-clinic-primary" />
                            <span>
                              <span className="block text-sm font-bold text-clinic-text">Sessão dupla (2 × 50 min)</span>
                              <span className="block text-[10px] text-clinic-text-muted">Ocupa dois horários consecutivos na agenda.</span>
                            </span>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Modalidade de pagamento</span>
                            <select value={editForm.paymentModal || PaymentModal.PIX_FULL} onChange={event => setEditForm(current => ({ ...current, paymentModal: event.target.value as PaymentModal }))} disabled={isSavingData} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary">
                              <option value={PaymentModal.PIX_FULL}>{PaymentModal.PIX_FULL}</option>
                              <option value={PaymentModal.PARCELADO}>{PaymentModal.PARCELADO}</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Início do pacote</span>
                            <input type="date" value={editForm.startDate || ''} onChange={event => setEditForm(current => ({ ...current, startDate: event.target.value }))} disabled={isSavingData} className="w-full rounded-xl border border-clinic-border bg-clinic-bg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-clinic-primary" />
                          </label>
                          <label className="block border-t border-clinic-border pt-4">
                            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">Status do Atendente</span>
                            <select value={editForm.status || 'Ativo'} onChange={event => setEditForm(current => ({ ...current, status: event.target.value as 'Ativo' | 'Concluído' }))} disabled={isSavingData} className={`w-full rounded-xl border border-clinic-border px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-clinic-primary ${editForm.status === 'Concluído' ? 'bg-status-red-bg text-status-red-text' : 'bg-status-green-bg text-status-green-text'}`}>
                              <option value="Ativo">🟢 Ativo</option>
                              <option value="Concluído">🔴 Concluído (Inativo)</option>
                            </select>
                            {editForm.status === 'Concluído' && patient.status !== 'Concluído' && (
                              <span className="mt-2 block rounded bg-red-50 p-2 text-[10px] font-medium text-status-red-text">Ao salvar como concluído, as sessões e reposições futuras serão removidas após a confirmação.</span>
                            )}
                          </label>
                        </div>
                      </section>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSubTab === 'sessoes' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                 <div className="flex items-center justify-between">
                    <div className="flex-1 max-w-sm space-y-1">
                      <div className="flex justify-between text-[10px] font-bold uppercase text-clinic-text-faint">
                        <span>Progresso do Pacote Atual</span>
                        <span>{realizedInPackage} / 10</span>
                      </div>
                      <div className="w-full h-2 bg-clinic-bg rounded-full overflow-hidden">
                        <div className="h-full bg-clinic-primary rounded-full" style={{ width: `${(realizedInPackage/10)*100}%` }}></div>
                      </div>
                    </div>
                 </div>
                 <div className="space-y-3">
                   {visiblePatientSessions.length > 0 ? (
                     visiblePatientSessions.map(session => (
                       <div key={session.id} className={cn(
                         "p-4 rounded-xl border flex items-center justify-between",
                         session.status === SessionStatus.REALIZADA ? 'bg-blue-500/10 border-blue-400 border-dashed' :
                         isCountedAbsenceSession(session) ? 'bg-[#FFF4F4] border-[#A94444]/30' :
                         session.status === SessionStatus.FALTA ? 'bg-red-500/10 border-red-500/20' :
                         session.status === SessionStatus.FALTA_PROF ? 'bg-orange-500/10 border-orange-500/20' :
                         'bg-transparent border-clinic-border'
                       )}>
                         <div className="flex items-center gap-4">
                            <Calendar size={18} className="text-clinic-text-faint" />
                            <div className="flex flex-col">
                              <span className="font-bold text-sm">{getSessionCycleLabel(state.sessions, session) || 'Sessão —'}</span>
                              <span className="text-xs text-clinic-text-muted">{safeFormatDate(session.date, 'dd/MM/yyyy')} às {session.time}</span>
                              <span className="text-[10px] text-clinic-text-muted italic">{session.type}</span>
                              {isCountedAbsenceSession(session) && <span className="mt-1 text-[10px] font-bold text-[#A94444]">Sem atividade registrada</span>}
                            </div>
                         </div>
                         <div className="flex items-center gap-3">
                            {session.notes && <span className="text-[10px] bg-clinic-bg px-2 py-1 rounded italic text-clinic-text-muted" title={session.notes}>Ver Obs</span>}
                            <div className="flex items-center gap-1 bg-clinic-bg/40 p-1 rounded-lg border border-clinic-border/50 mr-3">
                               {session.status !== SessionStatus.REALIZADA && session.status !== SessionStatus.REPOSICAO && session.status !== SessionStatus.CANCELADA && (
                                 <button onClick={() => updateSessionStatus(session.id, SessionStatus.REALIZADA)} className="p-1.5 rounded hover:bg-status-green-bg text-status-green-text transition-colors hover:shadow-sm" title="Marcar Presença">
                                   <CheckCircle size={14} />
                                 </button>
                               )}
                               {session.status !== SessionStatus.FALTA && session.status !== SessionStatus.FALTA_PROF && session.status !== SessionStatus.CANCELADA && (
                                 <button onClick={() => updateSessionStatus(session.id, SessionStatus.FALTA)} className="p-1.5 rounded hover:bg-status-red-bg text-status-red-text transition-colors hover:shadow-sm" title="Registrar Falta Atendente">
                                   <XCircle size={14} />
                                 </button>
                               )}
                               {session.status !== SessionStatus.FALTA_PROF && session.status !== SessionStatus.CANCELADA && (
                                 <button onClick={() => updateSessionStatus(session.id, SessionStatus.FALTA_PROF)} className="p-1.5 rounded hover:bg-status-orange-bg text-status-orange-text transition-colors hover:shadow-sm" title="Minha Falta">
                                   <XCircle size={14} />
                                 </button>
                               )}
                                                               {session.status !== SessionStatus.CANCELADA && session.status !== SessionStatus.REALIZADA && session.status !== SessionStatus.REPOSICAO && (
                                  <button onClick={() => updateSessionStatus(session.id, SessionStatus.CANCELADA)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 transition-colors hover:shadow-sm text-sm" title="Cancelar (Feriado/Imprevisto) - nao gera reposicao">
                                    🏖
                                  </button>
                                )}
                               {(session.status === SessionStatus.FALTA || session.status === SessionStatus.FALTA_PROF) && (
                                 <button onClick={() => setRepositionModalSession(session)} className="px-2 py-1.5 rounded hover:bg-status-blue-bg text-status-blue-text font-bold text-[10px] uppercase tracking-wide flex items-center gap-1 hover:shadow-sm transition-all" title="Agendar Reposição para esta Falta">
                                   <RefreshCw size={12} />
                                   <span className="hidden sm:inline">Repor</span>
                                 </button>
                               )}
                               {(session.status === SessionStatus.FALTA || session.status === SessionStatus.LATE_CANCELLATION_NO_REPLACEMENT) && (
                                 <button
                                   type="button"
                                   onClick={() => setAbsenceDecisionModal({
                                     sessionId: session.id,
                                     consumesPackage: typeof session.consumesPackage === 'boolean' ? session.consumesPackage : null,
                                     isEditing: true,
                                   })}
                                   className="px-2 py-1.5 rounded hover:bg-[#FFF4F4] text-[#A94444] font-bold text-[10px] uppercase tracking-wide flex items-center gap-1 hover:shadow-sm transition-all"
                                   title="Alterar contabilização da falta"
                                 >
                                   <DollarSign size={12} />
                                   <span className="hidden sm:inline">Contabilização</span>
                                 </button>
                               )}
                             </div>
                             <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", getStatusColor(session.status))}>
                               {getSessionPresentationStatus(session)}
                            </span>
                         </div>
                       </div>
                     ))
                   ) : (
                     <p className="text-center text-clinic-text-muted italic py-10">Nenhuma sessão registrada.</p>
                   )}
                 </div>
              </div>
            )}

            {activeSubTab === 'pacotes' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-lg font-bold text-clinic-text">Histórico de Pacotes</h5>
                  <span className="text-xs font-bold text-clinic-text-faint uppercase bg-clinic-bg px-3 py-1 rounded-full border">
                    Pacote Atual: #{currentPkgNumber} ({currentPkgProgress}/10 sessões)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {packageHistory.length > 0 ? (
                    packageHistory.map(pkg => {
                      const isCurrent = pkg.number === currentPkgNumber && !pkg.completed;
                      return (
                        <div
                          key={pkg.number}
                          className={cn(
                            "p-5 rounded-xl border flex flex-col justify-between transition-all hover:shadow-md h-full bg-white",
                            isCurrent
                              ? "bg-clinic-primary/5 border-clinic-primary/40 ring-1 ring-clinic-primary/20"
                              : "border-clinic-border/60"
                          )}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <span className={cn(
                              "text-xs font-black uppercase px-2.5 py-1 rounded-lg tracking-wider",
                              isCurrent ? "bg-clinic-primary text-white" : "bg-clinic-bg text-clinic-text-faint"
                            )}>
                              Pacote #{pkg.number}
                            </span>
                            <span className={cn(
                              "text-[10px] font-black uppercase px-2 py-0.5 rounded tracking-widest",
                              pkg.completed ? "bg-status-green-bg text-status-green-text" : "bg-status-orange-bg text-status-orange-text"
                            )}>
                              {pkg.completed ? "Concluído" : "Em Andamento"}
                            </span>
                          </div>

                          <div className="space-y-2 mb-4">
                            <div className="flex justify-between text-xs">
                              <span className="text-clinic-text-faint font-bold uppercase tracking-wider text-[10px]">Período</span>
                              <span className="text-clinic-text font-bold">
                                {pkg.startDate ? safeFormatDate(pkg.startDate, 'dd/MM/yyyy') : '--'} — {pkg.endDate ? safeFormatDate(pkg.endDate, 'dd/MM/yyyy') : '--'}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-clinic-text-faint font-bold uppercase tracking-wider text-[10px]">Sessões Contabilizadas</span>
                              <span className="text-clinic-text font-bold">{pkg.count} / 10</span>
                            </div>
                          </div>

                          <div className="w-full bg-clinic-bg h-2 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                isCurrent ? "bg-clinic-primary" : "bg-status-green-text"
                              )}
                              style={{ width: `${Math.min((pkg.count / 10) * 100, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-full py-10 text-center text-clinic-text-muted italic">
                      Nenhum pacote anterior registrado.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSubTab === 'financeiro' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-lg font-bold text-clinic-text">Resumo Financeiro</h5>
                  <div className="flex gap-2">
                    <button onClick={handleRegisterPaymentClick} className="px-3 py-1.5 bg-status-green-bg text-status-green-text font-bold text-xs uppercase tracking-wide rounded-lg hover:bg-green-100 transition-colors border border-green-200 shadow-sm hover:shadow">
                      + Registar Pagamento
                    </button>
                  </div>
                </div>

                {isLate && (
                  <div className="bg-status-red-bg border-l-4 border-status-red-text p-4 rounded-r-xl shadow-sm text-status-red-text flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="font-black text-xs tracking-wider uppercase mb-1">Aviso de Inadimplência</span>
                      <span className="font-medium text-sm">A 2ª parcela deste pacote está atrasada.</span>
                    </div>
                    <span className="bg-white px-3 py-1 rounded shadow-sm text-xs font-black uppercase">{daysLate} dias em atraso</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                   <div className="p-4 bg-status-green-bg text-status-green-text rounded-2xl border border-green-100 h-full">
                      <span className="block text-[10px] font-bold uppercase">Pago no pacote atual</span>
                      <span className="text-2xl font-bold">{formatCurrency(packageFinancialSummary.paidGross)}</span>
                   </div>
                   <div className="p-4 bg-status-orange-bg text-status-orange-text rounded-2xl border border-orange-100 h-full">
                      <span className="block text-[10px] font-bold uppercase">Status Financeiro</span>
                      <span className="text-2xl font-bold italic">{patient.paymentModal === PaymentModal.PIX_FULL ? 'Único' : 'Parcelado'}</span>
                   </div>
                </div>
                <div className="space-y-6">
                   {patientPayments.length > 0 ? (
                     Object.entries(
                       patientPayments.reduce((acc, p) => {
                         const pkg = p.packageNumber || getInferredPackageNumber(p.date);
                         if (!acc[pkg]) acc[pkg] = [];
                         acc[pkg].push(p);
                         return acc;
                       }, {} as Record<number, Payment[]>)
                     ).sort(([a], [b]) => Number(b) - Number(a)).map(([pkgNum, payments]) => (
                       <div key={pkgNum} className="space-y-3">
                         <h6 className="text-[10px] font-bold text-clinic-text-faint uppercase bg-clinic-border/30 px-3 py-1 rounded-lg inline-block tracking-wider">
                           Pacote {pkgNum}
                         </h6>
                         <div className="space-y-2">
                           {payments.map(payment => (
                             <div key={payment.id} className="p-4 rounded-xl border border-clinic-border flex items-center justify-between group">
                               <div className="flex items-center gap-4">
                                  <DollarSign size={18} className="text-status-green-text" />
                                  <div className="flex flex-col">
                                    <span className={cn('font-bold text-sm', !isPaymentActive(payment) && 'line-through text-clinic-text-muted')}>{formatCurrency(payment.amount)} — {payment.installment}</span>
                                    <span className="text-[10px] text-clinic-text-muted">{safeFormatDate(payment.date, 'dd/MM/yyyy')} via {payment.method}</span>
                                    {!isPaymentActive(payment) && <span className="text-[10px] text-status-red-text">Cancelado por {payment.voidedBy || 'Profissional'}: {payment.voidReason}</span>}
                                  </div>
                               </div>
                               <div className="flex items-center gap-2">
                                  {isPaymentActive(payment) && <button onClick={() => handleEditPaymentClick(payment)} className="p-1.5 text-clinic-text-muted hover:text-clinic-primary hover:bg-clinic-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Corrigir pagamento">
                                     <Edit3 size={14} />
                                  </button>}
                                  {isPaymentActive(payment) && <button onClick={() => handleDeletePaymentClick(payment.id)} className="p-1.5 text-clinic-text-muted hover:text-status-red-text hover:bg-status-red-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Cancelar pagamento">
                                     <Trash2 size={14} />
                                  </button>}
                                  <span className={cn('px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider', isPaymentActive(payment) ? 'bg-status-green-bg text-status-green-text' : 'bg-status-red-bg text-status-red-text')}>{isPaymentActive(payment) ? 'Recebido' : 'Cancelado'}</span>
                               </div>
                             </div>
                           ))}
                         </div>
                       </div>
                     ))
                   ) : (
                     <p className="text-center text-clinic-text-muted italic py-10">Nenhum pagamento registrado.</p>
                   )}
                </div>
              </div>
            )}

            {activeSubTab === 'anotacoes' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                 <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Notas Clínicas Gerais</label>
                 <textarea 
                  defaultValue={patient.clinicalNotes}
                  onBlur={(e) => {
                    updateNotes(e.target.value);
                    showToast('Anotações salvas.');
                  }}
                  className="w-full min-h-[350px] p-4 bg-clinic-bg rounded-2xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none transition-all shadow-inner"
                  placeholder="Descreva aqui o histórico clínico, comportamentos observados e notas técnicas..."
                 />
                 <p className="text-[10px] text-clinic-text-muted italic">* As anotações são salvas automaticamente ao sair do campo (clicar fora).</p>
              </div>
            )}

            {activeSubTab === 'evolucao' && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
                <div className="bg-clinic-bg/50 p-4 rounded-2xl border border-clinic-border space-y-3">
                  <h6 className="text-[10px] font-bold text-clinic-text-faint uppercase tracking-widest">Nova Evolução Diária</h6>
                  <div className="flex flex-col md:flex-row gap-3">
                    <input 
                      type="date" 
                      value={newEvoDate} 
                      onChange={e => setNewEvoDate(e.target.value)}
                      className="px-4 py-2 bg-white rounded-xl border border-clinic-border text-sm outline-none w-full md:w-auto"
                    />
                    <input 
                      type="text" 
                      placeholder="Descreva a evolução da sessão..." 
                      value={newEvoNotes}
                      onChange={e => setNewEvoNotes(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSaveEvolution()}
                      className="flex-1 px-4 py-2 bg-white rounded-xl border border-clinic-border text-sm outline-none focus:ring-2 focus:ring-clinic-primary transition-all"
                    />
                    <button 
                      onClick={handleSaveEvolution}
                      disabled={!newEvoNotes.trim()}
                      className="px-4 py-2 bg-clinic-primary text-white font-bold rounded-xl shadow-md disabled:opacity-50 hover:bg-clinic-primary-hover transition-all text-xs uppercase tracking-wider"
                    >
                      Salvar
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {patientEvolutions.length > 0 ? (
                    patientEvolutions.map(evo => (
                      <div key={evo.id} className="relative pl-6 pb-4 border-l-2 border-clinic-border/50 last:border-0 last:pb-0">
                        <div className="absolute left-[-5px] top-0 w-2 h-2 rounded-full bg-clinic-primary"></div>
                        <div className="bg-white p-4 rounded-xl border border-clinic-border shadow-sm flex flex-col gap-2 relative -top-3">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-clinic-text bg-clinic-bg px-2 py-1 rounded">
                              {safeFormatDate(evo.date, 'dd/MM/yyyy')}
                            </span>
                            <button 
                              onClick={() => {
                                if (confirm('Excluir esta evolução?')) {
                                  onUpdate({ evolutions: (state.evolutions || []).filter(e => e.id !== evo.id) });
                                }
                              }}
                              className="text-status-red-text hover:bg-red-50 p-1.5 rounded transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <p className="text-sm text-clinic-text whitespace-pre-line leading-relaxed">{evo.notes}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-clinic-text-muted italic py-10">Nenhuma evolução registrada.</p>
                  )}
                </div>
              </div>
            )}
          </div>
       </div>

      {repositionModalSession && (
        <Modal
          isOpen={true}
          onClose={() => setRepositionModalSession(null)}
          title="Agendar Reposição"
          width="max-w-md"
        >
          <div className="space-y-6">
            <p className="text-clinic-text text-sm">
              Agendando reposição para a falta do dia: <span className="font-bold">{safeFormatDate(repositionModalSession.date, 'dd/MM/yyyy')}</span>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Data da Reposição</label>
                <input 
                  type="date" 
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={repoDate}
                  onChange={e => setRepoDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Horário</label>
                <select 
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={repoTime}
                  onChange={e => setRepoTime(e.target.value)}
                >
                  {AVAILABLE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setRepositionModalSession(null)}
                className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleScheduleReposition}
                className="px-4 py-2 bg-status-blue-bg text-status-blue-text font-bold rounded-lg hover:bg-blue-200 transition-all uppercase tracking-wide text-xs"
              >
                Confirmar Agendamento
              </button>
            </div>
          </div>
        </Modal>
      )}

      {paymentModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setPaymentModalOpen(false)}
          title="Registrar Pagamento"
          width="max-w-md"
        >
          <div className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Pacote Referente</label>
                <select 
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={paymentData.packageNumber}
                  onChange={e => setPaymentData(prev => ({ ...prev, packageNumber: parseInt(e.target.value) || 1 }))}
                >
                  {Array.from({ length: Math.max(1, Math.ceil(patientSessions.length / 10), paymentData.packageNumber) }, (_, i) => i + 1).map(num => (
                    <option key={num} value={num}>Pacote {num}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Data do Pagamento</label>
                <input 
                  type="date" 
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={paymentData.date}
                  onChange={e => setPaymentData(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Tipo / Parcela</label>
                <select 
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={paymentData.installment}
                  onChange={e => {
                    const inst = e.target.value as any;
                    let amt = 500;
                    if (inst === 'Pagamento integral') amt = 1000;
                    setPaymentData(prev => ({ ...prev, installment: inst, amount: amt }));
                  }}
                >
                  <option value="Pagamento integral">Pagamento integral — R$ 1.000,00</option>
                  <option value="1ª parcela">1ª parcela — R$ 500,00</option>
                  <option value="2ª parcela">2ª parcela — R$ 500,00</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Valor</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={paymentData.amount}
                  onChange={e => setPaymentData(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Método de Pagamento</label>
                <select 
                  className="w-full bg-clinic-bg border border-clinic-border rounded-lg p-2.5 text-sm"
                  value={paymentData.method}
                  onChange={e => setPaymentData(prev => ({ ...prev, method: e.target.value as any }))}
                >
                  <option value="Pix">Pix</option>
                  <option value="Dinheiro">Dinheiro</option>
                  <option value="Transferência">Transferência</option>
                  <option value="Outro">Outro</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setPaymentModalOpen(false)}
                className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
              >
                Cancelar
              </button>
              <button
                onClick={handleSavePayment}
                disabled={isSavingPayment}
                className="px-4 py-2 bg-status-green-bg text-status-green-text font-bold rounded-lg hover:bg-green-200 transition-all uppercase tracking-wide text-xs"
              >
                {isSavingPayment ? 'Registrando...' : 'Confirmar Recebimento'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal Desativar Paciente e Excluir Futuras */}
      <Modal
        isOpen={confirmInactivate}
        onClose={() => setConfirmInactivate(false)}
        title="Confirmar Desativação"
        width="max-w-md"
      >
        <div className="space-y-6">
          <p className="text-clinic-text font-medium">
            Você está marcando este atendente como "Concluído".
            Deseja também excluir todas as sessões e reposições futuras agendadas para ele?
          </p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => executeSavePatientData(true)}
              disabled={isSavingData}
              className="px-4 py-3 bg-status-red-text text-white font-bold rounded-lg shadow-md hover:bg-red-700 transition-all text-sm w-full text-center disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingData ? 'Salvando...' : 'Sim, excluir agendamentos futuros'}
            </button>
            <button
              onClick={() => executeSavePatientData(false)}
              disabled={isSavingData}
              className="px-4 py-3 bg-clinic-bg border border-clinic-border text-clinic-text font-bold rounded-lg hover:bg-clinic-bg/80 transition-all text-sm w-full text-center disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingData ? 'Salvando...' : 'Não, manter na agenda'}
            </button>
            <button
              onClick={() => setConfirmInactivate(false)}
              disabled={isSavingData}
              className="mt-2 text-xs text-clinic-text-muted hover:underline uppercase tracking-wide text-center disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancelar Edição
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Confirmar Novo Pacote */}
      <Modal
        isOpen={confirmNewPackage}
        onClose={() => setConfirmNewPackage(false)}
        title="Gerar Novo Pacote"
        width="max-w-md"
      >
        <div className="space-y-6">
          <p className="text-clinic-text font-medium">
            Deseja gerar 10 novas sessões automáticas para este paciente, seguindo o dia e horário fixo configurado ({patient?.fixedDay} às {patient?.fixedTime})?
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setConfirmNewPackage(false)}
              className="px-4 py-2 bg-clinic-bg text-clinic-text-muted font-bold rounded-lg hover:bg-clinic-border transition-all uppercase tracking-wide text-xs"
            >
              Cancelar
            </button>
            <button
              onClick={executeGenerateNewPackage}
              className="px-4 py-2 bg-clinic-primary text-white font-bold rounded-lg shadow-md hover:bg-clinic-primary-hover transition-all uppercase tracking-wide text-xs"
            >
              Gerar Sessões
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Confirmação de Alteração de Cronograma Fixo */}
      {confirmScheduleChange && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmScheduleChange(null)}
          title="Alteração de Dia/Horário Fixo"
          width="max-w-lg"
        >
          <div className="space-y-6">
            <div className="p-4 bg-clinic-bg rounded-xl border border-clinic-border text-sm text-clinic-text space-y-3">
              <p>
                Você alterou o dia/horário fixo de <strong>{patient.name}</strong>:
              </p>
              <div className="flex items-center gap-4 justify-center bg-white p-3 rounded-lg border border-clinic-border text-sm">
                <div className="text-center">
                  <span className="block text-[10px] uppercase font-bold text-clinic-text-faint">Anterior</span>
                  <span className="font-bold text-status-red-text">
                    {confirmScheduleChange.oldDay} às {confirmScheduleChange.oldTime}
                    {confirmScheduleChange.oldDouble && " (Dupla)"}
                  </span>
                </div>
                <ChevronRight className="text-clinic-text-faint" size={20} />
                <div className="text-center">
                  <span className="block text-[10px] uppercase font-bold text-clinic-text-faint">Novo</span>
                  <span className="font-bold text-status-green-text">
                    {confirmScheduleChange.newDay} às {confirmScheduleChange.newTime}
                    {confirmScheduleChange.newDouble && " (Dupla)"}
                  </span>
                </div>
              </div>
              
              {confirmScheduleChange.conflictingNames.length > 0 && (
                <div className="p-3 bg-status-orange-bg/25 border border-status-orange-text/20 rounded-lg text-xs text-status-orange-text font-medium space-y-1">
                  <p className="font-bold uppercase tracking-wider flex items-center gap-1">
                    ⚠️ Conflito de Horário
                  </p>
                  <p>
                    O novo dia/horário já está ocupado por outro(s) paciente(s) ativo(s):
                  </p>
                  <ul className="list-disc pl-4 font-bold">
                    {confirmScheduleChange.conflictingNames.map((name, idx) => (
                      <li key={idx}>{name}</li>
                    ))}
                  </ul>
                  <p className="text-[10px] italic">
                    (O sistema permite múltiplos atendimentos no mesmo horário se desejar prosseguir)
                  </p>
                </div>
              )}
            </div>

            <p className="text-sm text-clinic-text">
              Deseja realinhar automaticamente as sessões futuras agendadas para o novo dia/horário fixo?
            </p>
            <p className="text-xs text-clinic-text-muted leading-relaxed">
              O histórico anterior será preservado: semanas passadas continuarão usando o dia/horário que estava vigente na época, e o novo horário valerá a partir de hoje.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => executeSavePatientDataWithRealignment(true)}
                disabled={isSavingData}
                className="px-4 py-3 bg-clinic-primary text-white font-bold rounded-lg shadow-md hover:bg-clinic-primary-hover transition-all text-sm w-full text-center uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingData ? 'Salvando...' : 'Sim, realinhar agenda futura (Recomendado)'}
              </button>
              <button
                onClick={() => executeSavePatientDataWithRealignment(false)}
                disabled={isSavingData}
                className="px-4 py-3 bg-clinic-bg border border-clinic-border text-clinic-text font-bold rounded-lg hover:bg-clinic-bg/80 transition-all text-sm w-full text-center uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingData ? 'Salvando...' : 'Não, salvar apenas o cadastro'}
              </button>
              <button
                onClick={() => setConfirmScheduleChange(null)}
                disabled={isSavingData}
                className="mt-2 text-xs text-clinic-text-muted hover:underline uppercase tracking-wide text-center disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar Edição
              </button>
            </div>
          </div>
        </Modal>
      )}
      </Modal>
    </>
  );
}
