import React, { useEffect, useState, useMemo } from 'react';
import { AppState, Patient, SessionStatus, PaymentModal, SessionType, Session, Reposition, Payment, Evolution, ExternalRegistrationForm } from '../types';
import { Plus, Search, MessageCircle, FileText, Trash2, Edit3, DollarSign, Clock, Calendar, Users, CheckCircle, XCircle, RefreshCw, X, ChevronRight, AlertTriangle, Link as LinkIcon, ClipboardCopy } from 'lucide-react';
import { calculateAge, cn, getStatusColor, formatCurrency, safeFormatDate, normalizeStr, isValidTime, normalizeTime, addOneHour, getDayOfWeekIndex, schedulesOverlap, getNextValidDates } from '../lib/utils';
import Modal from './Common/Modal';
import PatientPhoto from './Common/PatientPhoto';
import { showToast } from './Common/Toast';
import { AVAILABLE_DAYS, AVAILABLE_TIMES, CLINIC_INFO } from '../constants';
import { format, differenceInDays, parseISO, getDay, addDays } from 'date-fns';
import { createStrongToken, getExternalRegistrationExpiry, getExternalRegistrationExpiryMs, patientToExternalRegistrationData, sanitizeForFirestore } from '../lib/externalRegistration';
import { cancelPatientPhotoUpload, deletePatientPhoto, getPatientPhotoErrorMessage, uploadPatientPhoto, validatePatientPhoto } from '../lib/patientPhotoStorage';
import { db } from '../firebase';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

interface PatientsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void | Promise<void>;
  selectedPatientId?: string | null;
  setSelectedPatientId?: (id: string | null) => void;
  currentUserId?: string;
  currentUserName?: string;
}

const PATIENT_FIELD_LABELS: Record<string, string> = {
  name: 'nome',
  birthDate: 'nascimento',
  guardianName: 'responsável',
  whatsapp: 'WhatsApp',
  school: 'escola',
  grade: 'ano escolar',
  shift: 'turno',
  doctorName: 'médico',
  medication: 'medicação',
};

function getFieldLabelForPatient(field: string) {
  return PATIENT_FIELD_LABELS[field] || field;
}

function hasPatientPhoto(patient: Pick<Patient, 'photoUrl' | 'photoDriveFileId'>): boolean {
  return Boolean(patient.photoDriveFileId || patient.photoUrl);
}

export default function Patients({ state, onUpdate, selectedPatientId: propSelectedId, setSelectedPatientId: propSetSelectedId, currentUserId, currentUserName }: PatientsProps) {
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
  
  // Registration Form State
  const [newPatient, setNewPatient] = useState<Partial<Patient>>({
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

    if (!newPatient.name || !newPatient.birthDate || !newPatient.guardianName || !newPatient.whatsapp) {
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
    };

    // Auto-generate 1st package sessions and payments
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

    const generatedPayments: Payment[] = [];
    if (patient.paymentModal === PaymentModal.PIX_FULL) {
      generatedPayments.push({
        id: Math.random().toString(36).substr(2, 9),
        patientId: id,
        amount: 1000,
        date: generatedSessions[0].date,
        installment: 'Pagamento integral',
        method: 'Pix'
      });
    } else {
      generatedPayments.push({
        id: Math.random().toString(36).substr(2, 9),
        patientId: id,
        amount: 500,
        date: generatedSessions[0].date,
        installment: '1ª parcela',
        method: 'Pix'
      });
      generatedPayments.push({
        id: Math.random().toString(36).substr(2, 9),
        patientId: id,
        amount: 500,
        date: generatedSessions[4].date,
        installment: '2ª parcela',
        method: 'Pix'
      });
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
        sessions: [...state.sessions, ...generatedSessions],
        payments: [...state.payments, ...generatedPayments]
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
    const updatedPayments = state.payments.filter(p => p.patientId !== patientToDelete);
    const updatedRepositions = state.repositions.filter(r => r.patientId !== patientToDelete);

    try {
      await Promise.resolve(onUpdate({
        patients: updatedPatients,
        sessions: updatedSessions,
        payments: updatedPayments,
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
              placeholder="Buscar por nome da criança ou responsável..."
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
              const totalRealized = state.sessions.filter(s => s.patientId === patient.id && (s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)).length;
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
                    className="w-14 h-14 rounded-full object-cover border-2 border-clinic-primary/20 shrink-0 shadow-sm"
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
                          <span>{displayAttended} atendidas • {displayRemaining} restantes</span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <h4 className="text-lg font-bold border-b border-clinic-border pb-2 flex items-center gap-2">
                <Users size={18} className="text-clinic-primary" />
                Dados Pessoais
              </h4>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Nome da Criança *</label>
                <input 
                  type="text" 
                  value={newPatient.name || ''}
                  onChange={e => setNewPatient({...newPatient, name: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Nascimento *</label>
                  <input 
                    type="date" 
                    value={newPatient.birthDate || ''}
                    onChange={e => setNewPatient({...newPatient, birthDate: e.target.value})}
                    className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Idade Estimada</label>
                  <div className="px-4 py-3 bg-clinic-bg/50 rounded-xl border border-clinic-border text-clinic-text-muted italic text-sm">
                    {newPatient.birthDate ? `${calculateAge(newPatient.birthDate)} anos` : '--'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Responsável *</label>
                <input 
                  type="text" 
                  value={newPatient.guardianName || ''}
                  onChange={e => setNewPatient({...newPatient, guardianName: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">WhatsApp *</label>
                <input 
                  type="text" 
                  placeholder="27 99999-0000"
                  value={newPatient.whatsapp || ''}
                  onChange={e => setNewPatient({...newPatient, whatsapp: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Foto</label>
                <input 
                  type="file" 
                  accept="image/jpeg,image/png,image/webp"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;

                    try {
                      validatePatientPhoto(file);
                      setNewPatientPhotoFile(file);
                      setNewPatientPhotoPreviewUrl(URL.createObjectURL(file));
                    } catch (error) {
                      setNewPatientPhotoFile(null);
                      setNewPatientPhotoPreviewUrl(null);
                      e.currentTarget.value = '';
                      showToast(getPatientPhotoErrorMessage(error), 'error');
                    }
                  }}
                  className="px-4 py-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm block w-full text-clinic-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-clinic-primary/10 file:text-clinic-primary hover:file:bg-clinic-primary/20"
                />
                {newPatientPhotoPreviewUrl && (
                  <div className="mt-2 flex items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg/50 p-2">
                    <img
                      src={newPatientPhotoPreviewUrl}
                      alt="Prévia da foto selecionada"
                      className="h-14 w-14 rounded-full border border-clinic-border object-cover"
                    />
                    <p className="text-xs text-clinic-text-muted">
                      A foto será enviada ao armazenamento quando o cadastro for salvo.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-lg font-bold border-b border-clinic-border pb-2 flex items-center gap-2">
                <FileText size={18} className="text-clinic-primary" />
                Escolar e Clínico
              </h4>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Escola</label>
                <input 
                  type="text" 
                  value={newPatient.school || ''}
                  onChange={e => setNewPatient({...newPatient, school: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Ano Escolar</label>
                  <input 
                    type="text" 
                    value={newPatient.grade || ''}
                    onChange={e => setNewPatient({...newPatient, grade: e.target.value})}
                    className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Turno</label>
                  <select 
                    value={newPatient.shift || ''}
                    onChange={e => setNewPatient({...newPatient, shift: e.target.value})}
                    className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                  >
                    <option value="">-</option>
                    <option value="Manhã">Manhã</option>
                    <option value="Tarde">Tarde</option>
                    <option value="Integral">Integral</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Médico Cuidando</label>
                <input 
                  type="text" 
                  value={newPatient.doctorName || ''}
                  onChange={e => setNewPatient({...newPatient, doctorName: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Medicação em Uso</label>
                <input 
                  type="text" 
                  value={newPatient.medication || ''}
                  onChange={e => setNewPatient({...newPatient, medication: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
              <div className="flex flex-col gap-1 pt-2">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Upload Relatório (PDF)</label>
                <input 
                  type="file" 
                  accept="application/pdf"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => setNewPatient(prev => ({ ...prev, reportPdfUrl: reader.result as string }));
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="px-4 py-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm block w-full text-clinic-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-clinic-primary/10 file:text-clinic-primary hover:file:bg-clinic-primary/20"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Upload Parecer (PDF)</label>
                <input 
                  type="file" 
                  accept="application/pdf"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => setNewPatient(prev => ({ ...prev, opinionPdfUrl: reader.result as string }));
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="px-4 py-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm block w-full text-clinic-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-clinic-primary/10 file:text-clinic-primary hover:file:bg-clinic-primary/20"
                />
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-lg font-bold border-b border-clinic-border pb-2 flex items-center gap-2">
                <Clock size={18} className="text-clinic-primary" />
                Configuração do Pacote
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Dia Fixo</label>
                  <select 
                    value={newPatient.fixedDay}
                    onChange={e => setNewPatient({...newPatient, fixedDay: e.target.value})}
                    className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                  >
                    {AVAILABLE_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Horário Fixo</label>
                  <select 
                    value={AVAILABLE_TIMES.includes(newPatient.fixedTime || '') ? newPatient.fixedTime : 'custom'}
                    onChange={e => {
                      if (e.target.value === 'custom') {
                        setNewPatient({...newPatient, fixedTime: '17:30'});
                      } else {
                        setNewPatient({...newPatient, fixedTime: e.target.value});
                      }
                    }}
                    className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full"
                  >
                    {AVAILABLE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                    <option value="custom">Outro horário...</option>
                  </select>
                  {(!newPatient.fixedTime || !AVAILABLE_TIMES.includes(newPatient.fixedTime)) && (
                    <input
                      type="text"
                      placeholder="Ex: 17:30"
                      value={newPatient.fixedTime || ''}
                      onChange={e => setNewPatient({...newPatient, fixedTime: e.target.value})}
                      className="px-4 py-3 mt-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full"
                    />
                  )}
                </div>
              </div>
              {/* Toggle Sessão Dupla */}
              <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-clinic-border bg-clinic-bg hover:bg-clinic-primary/5 transition-all">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={!!newPatient.doubleSession}
                    onChange={e => setNewPatient({...newPatient, doubleSession: e.target.checked})}
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${newPatient.doubleSession ? 'bg-clinic-primary' : 'bg-clinic-border'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${newPatient.doubleSession ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-bold text-clinic-text">Sessão Dupla (2 × 50 min)</p>
                  <p className="text-[10px] text-clinic-text-muted">Ocupa dois horários consecutivos na agenda</p>
                </div>
              </label>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Modalidade de Pagamento</label>
                <select 
                  value={newPatient.paymentModal}
                  onChange={e => setNewPatient({...newPatient, paymentModal: e.target.value as PaymentModal})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                >
                  <option value={PaymentModal.PIX_FULL}>{PaymentModal.PIX_FULL}</option>
                  <option value={PaymentModal.PARCELADO}>{PaymentModal.PARCELADO}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-clinic-text-faint uppercase">Início do Pacote</label>
                <input 
                  type="date" 
                  value={newPatient.startDate || ''}
                  onChange={e => setNewPatient({...newPatient, startDate: e.target.value})}
                  className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm"
                />
              </div>
            </div>
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
        />
      )}
    </div>
  );
}

function PatientDetailsModal({ isOpen, onClose, patient, state, onUpdate, currentUserId, currentUserName, createExternalRegistrationForm, copyExternalRegistrationLink }: { key?: string, isOpen: boolean, onClose: () => void, patient: Patient, state: AppState, onUpdate: (s: Partial<AppState>) => void | Promise<void>, currentUserId: string, currentUserName: string, createExternalRegistrationForm: (type: 'new' | 'update', linkedPatient?: Patient) => Promise<string>, copyExternalRegistrationLink: (link: string) => Promise<void> }) {
  const [activeSubTab, setActiveSubTab] = useState('dados');
  const [isEditingData, setIsEditingData] = useState(false);
  const [isPhotoExpanded, setIsPhotoExpanded] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Patient>>(patient);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoPreviewUrl, setPendingPhotoPreviewUrl] = useState<string | null>(null);
  const [isSavingData, setIsSavingData] = useState(false);
  const [repositionModalSession, setRepositionModalSession] = useState<Session | null>(null);
  const [repoDate, setRepoDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [repoTime, setRepoTime] = useState(patient?.fixedTime || '08:00');
  
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
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
  
  const [newEvoDate, setNewEvoDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newEvoNotes, setNewEvoNotes] = useState('');
  const [lastGeneratedExternalLink, setLastGeneratedExternalLink] = useState('');

  useEffect(() => {
    return () => {
      if (pendingPhotoPreviewUrl) {
        URL.revokeObjectURL(pendingPhotoPreviewUrl);
      }
    };
  }, [pendingPhotoPreviewUrl]);

  if (!patient) return null;

  const patientSessions = state.sessions.filter(s => s.patientId === patient.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const patientPayments = state.payments.filter(p => p.patientId === patient.id).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
  // Realized sessions sorted chronologically (ascending)
  const realizedSessionsChronological = patientSessions
    .filter(s => s.status === SessionStatus.REALIZADA || s.status === SessionStatus.REPOSICAO)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const realizedCount = realizedSessionsChronological.length;
  const realizedInPackage = realizedCount === 0 ? 0 : (realizedCount % 10 === 0 ? 10 : realizedCount % 10);

  const isLate = patient.paymentModal === PaymentModal.PARCELADO && realizedCount >= 6 && !patientPayments.some(p => p.installment === '2ª parcela');
  let daysLate = 0;
  if (isLate && realizedSessionsChronological[5]) {
    daysLate = differenceInDays(new Date(), new Date(realizedSessionsChronological[5].date));
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

    setEditForm(patient);
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

  const updateSessionStatus = (sessionId: string, newStatus: SessionStatus) => {
    let finalStatus = newStatus;
    const session = state.sessions.find(s => s.id === sessionId);
    if (newStatus === SessionStatus.REALIZADA && session?.notes?.includes('Reposição referente')) {
        finalStatus = SessionStatus.REPOSICAO;
    }

    let updatedSessions = state.sessions.map(s => s.id === sessionId ? { ...s, status: finalStatus } : s);
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
    onUpdate({ sessions: updatedSessions, repositions: updatedRepositions });
    showToast(`Status atualizado para ${finalStatus}.`);
  };

  const handleRegisterPaymentClick = () => {
    const currentPackageNumber = Math.max(1, Math.ceil(patientSessions.length / 10));
      
    setPaymentData({
      date: format(new Date(), 'yyyy-MM-dd'),
      installment: patient?.paymentModal === PaymentModal.PIX_FULL ? 'Pagamento integral' : '1ª parcela',
      amount: patient?.paymentModal === PaymentModal.PIX_FULL ? 1000 : 500,
      method: 'Pix',
      packageNumber: currentPackageNumber
    });
    setPaymentModalOpen(true);
  };

  const handleEditPaymentClick = (payment: Payment) => {
    setPaymentData({
      id: payment.id,
      date: payment.date,
      installment: payment.installment as any,
      amount: payment.amount,
      method: payment.method as any,
      packageNumber: payment.packageNumber || 1
    });
    setPaymentModalOpen(true);
  };

  const handleDeletePaymentClick = (paymentId: string) => {
    if (window.confirm("Tem certeza que deseja excluir este pagamento?")) {
      onUpdate({ payments: state.payments.filter(p => p.id !== paymentId) });
      showToast('Pagamento excluído com sucesso!');
    }
  };

  const handleSavePayment = () => {
    if (paymentData.id) {
      const updatedPayments = state.payments.map(p => 
        p.id === paymentData.id 
          ? { ...p, amount: paymentData.amount, date: paymentData.date, installment: paymentData.installment, method: paymentData.method, packageNumber: paymentData.packageNumber } 
          : p
      );
      onUpdate({ payments: updatedPayments });
      showToast('Pagamento atualizado com sucesso!', 'success');
    } else {
      const newPayment: Payment = {
        id: Math.random().toString(36).substr(2, 9),
        patientId: patient.id,
        amount: paymentData.amount,
        date: paymentData.date,
        installment: paymentData.installment,
        method: paymentData.method,
        packageNumber: paymentData.packageNumber
      };
      
      onUpdate({ payments: [...state.payments, newPayment] });
      showToast('Pagamento registrado com sucesso!', 'success');
    }
    setPaymentModalOpen(false);
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
  const totalPaid = patientPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const hasSecondPayment = patientPayments.some(p => p.installment === '2ª parcela');
  const financialStatus = isLate
    ? { label: 'Atraso', detail: `${daysLate} dias`, tone: 'red' }
    : patient.paymentModal === PaymentModal.PARCELADO && realizedInPackage >= 4 && !hasSecondPayment
      ? { label: 'Cobrar em breve', detail: '2ª parcela', tone: 'orange' }
      : { label: 'Em dia', detail: formatCurrency(totalPaid), tone: 'green' };
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
    { id: 'dados', label: 'Dados Cadastrais', icon: Users },
    { id: 'sessoes', label: 'Sessões', icon: Calendar },
    { id: 'pacotes', label: 'Hist. Pacotes', icon: RefreshCw },
    { id: 'financeiro', label: 'Financeiro', icon: DollarSign },
    { id: 'anotacoes', label: 'Anotações Gerais', icon: Edit3 },
    { id: 'evolucao', label: 'Evolução Clínica', icon: FileText },
  ];

  const updateNotes = (notes: string) => {
    const updatedPatients = state.patients.map(p => p.id === patient.id ? { ...p, clinicalNotes: notes } : p);
    onUpdate({ patients: updatedPatients });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClosePatientModal}
      title={patient.name}
      width="max-w-5xl"
    >
       <div className="flex flex-col gap-6">
          {/* Resumo inteligente */}
          <section className="border border-clinic-border bg-clinic-surface rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-5 bg-clinic-bg/50 border-b border-clinic-border flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
              <div className="flex items-center gap-4 min-w-0">
                <PatientPhoto
                  patient={patient}
                  alt={patient.name}
                  onClick={hasPatientPhoto(patient) ? () => setIsPhotoExpanded(true) : undefined}
                  className="w-20 h-20 rounded-xl object-cover border border-clinic-border shadow-sm cursor-pointer hover:opacity-90 transition"
                  fallbackClassName="w-20 h-20 rounded-xl bg-white border border-clinic-border flex items-center justify-center text-3xl font-bold text-clinic-primary shadow-sm"
                  fallbackText={patient.name.charAt(0)}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-2xl font-bold text-clinic-text truncate">{patient.name}</h3>
                    <span className={cn(
                      'px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border',
                      patient.status === 'Ativo' ? 'bg-status-green-bg text-status-green-text border-status-green-text/20' : 'bg-status-red-bg text-status-red-text border-status-red-text/20'
                    )}>
                      {patient.status}
                    </span>
                  </div>
                  <p className="text-sm text-clinic-text-muted font-medium">
                    {calculateAge(patient.birthDate)} anos • Responsável: {patient.guardianName || 'não informado'}
                  </p>
                  <p className="text-xs text-clinic-text-faint font-bold uppercase mt-1">
                    {patient.fixedDay || 'sem dia'} às {patient.fixedTime || '--:--'} {patient.doubleSession ? '• sessão dupla' : ''}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:min-w-[420px]">
                {[
                  { icon: RefreshCw, title: 'Pacote', ...packageStatus },
                  { icon: DollarSign, title: 'Financeiro', ...financialStatus },
                  { icon: MessageCircle, title: 'WhatsApp', ...whatsappStatus },
                  { icon: FileText, title: 'Documentos', ...documentStatus },
                ].map(item => (
                  <div key={item.title} className={cn('rounded-lg border px-3 py-2 min-h-[74px]', statusToneClass(item.tone))}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <item.icon size={13} />
                      <span className="text-[9px] font-black uppercase tracking-widest">{item.title}</span>
                    </div>
                    <p className="text-sm font-black leading-tight truncate">{item.label}</p>
                    <p className="text-[10px] font-bold opacity-80 truncate">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4">
              <div className="bg-white/70 border border-clinic-border/70 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-clinic-text-faint mb-1">Completude</p>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-clinic-text">{completionScore}%</span>
                  <div className="flex-1 h-2 rounded-full bg-clinic-border overflow-hidden">
                    <div className={cn(
                      'h-full rounded-full',
                      completionScore >= 80 ? 'bg-status-green-text' : completionScore >= 55 ? 'bg-status-orange-text' : 'bg-status-red-text'
                    )} style={{ width: `${completionScore}%` }} />
                  </div>
                </div>
              </div>
              <div className="bg-white/70 border border-clinic-border/70 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-clinic-text-faint mb-1">Próxima sessão</p>
                <p className="text-sm font-bold text-clinic-text">
                  {nextSession ? `${safeFormatDate(nextSession.date, 'dd/MM')} às ${nextSession.time}` : 'Nenhuma agendada'}
                </p>
              </div>
              <div className="bg-white/70 border border-clinic-border/70 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-clinic-text-faint mb-1">Reposições</p>
                <p className={cn('text-sm font-bold', pendingRepositionsCount > 0 ? 'text-status-orange-text' : 'text-clinic-text')}>
                  {pendingRepositionsCount > 0 ? `${pendingRepositionsCount} pendente(s)` : 'Sem pendências'}
                </p>
              </div>
              <div className="bg-white/70 border border-clinic-border/70 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-clinic-text-faint mb-1">Última evolução</p>
                <p className="text-sm font-bold text-clinic-text">
                  {lastEvolution ? safeFormatDate(lastEvolution.date, 'dd/MM/yyyy') : 'Sem registro'}
                </p>
              </div>
            </div>

            {(missingDocuments.length > 0 || isLate || realizedInPackage >= 8 || !patient.whatsapp?.trim()) && (
              <div className="px-4 pb-4 flex flex-col gap-2">
                {isLate && (
                  <div className="flex items-center gap-2 text-xs font-bold text-status-red-text bg-status-red-bg border border-status-red-text/20 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} /> Segunda parcela em atraso há {daysLate} dia(s).
                  </div>
                )}
                {realizedInPackage >= 8 && (
                  <div className="flex items-center gap-2 text-xs font-bold text-status-orange-text bg-status-orange-bg border border-status-orange-text/20 rounded-lg px-3 py-2">
                    <RefreshCw size={14} /> Pacote em fase de renovação ({realizedInPackage}/10).
                  </div>
                )}
                {!patient.whatsapp?.trim() && (
                  <div className="flex items-center gap-2 text-xs font-bold text-status-red-text bg-status-red-bg border border-status-red-text/20 rounded-lg px-3 py-2">
                    <MessageCircle size={14} /> WhatsApp não informado.
                  </div>
                )}
                {missingDocuments.length > 0 && (
                  <div className="flex items-center gap-2 text-xs font-bold text-clinic-text-muted bg-clinic-bg border border-clinic-border rounded-lg px-3 py-2">
                    <FileText size={14} /> Pendências cadastrais/documentais: {missingDocuments.join(', ')}.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Header Actions */}
          <div className="flex flex-wrap items-center gap-3 bg-clinic-bg/50 p-4 rounded-xl border border-clinic-border">
            <a 
              href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(confirmSessionMessage)}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-status-green-bg text-status-green-text rounded-lg font-bold text-[10px] uppercase tracking-wide hover:scale-105 transition-all"
            >
              <MessageCircle size={14} /> Confirmar Sessão
            </a>
            {patient.paymentModal === PaymentModal.PARCELADO && realizedInPackage >= 4 && (
               <a 
                href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(paymentMessage)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-status-orange-bg text-status-orange-text rounded-lg font-bold text-[10px] uppercase tracking-wide hover:scale-105 transition-all"
               >
                 <DollarSign size={14} /> Lembrar Pagamento
               </a>
            )}
            {realizedInPackage >= 8 && (
               <div className="flex items-center gap-2">
                 <a 
                  href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(renovationMessage)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-status-blue-bg text-status-blue-text rounded-lg font-bold text-[10px] uppercase tracking-wide hover:scale-105 transition-all"
                  title="Enviar mensagem WhatsApp lembrando da renovação"
                 >
                   <MessageCircle size={14} /> Lembrar Renovação
                 </a>
                 <button 
                  onClick={handleGenerateNewPackage}
                  className="flex items-center gap-2 px-4 py-2 bg-clinic-text text-white rounded-lg font-bold text-[10px] uppercase tracking-wide hover:scale-105 transition-all"
                  title="Adicionar 10 novas sessões ao calendário"
                 >
                   <Plus size={14} /> Gerar Novo Pacote
                 </button>
               </div>
            )}
          </div>

          {/* Nav */}
          <div className="flex flex-wrap border-b border-clinic-border gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={cn(
                  "px-4 py-2 font-bold text-xs uppercase tracking-wider transition-all border-b-2 flex items-center gap-1.5 whitespace-nowrap",
                  activeSubTab === tab.id ? "border-clinic-primary text-clinic-primary bg-clinic-primary/5" : "border-transparent text-clinic-text-faint hover:text-clinic-primary"
                )}
              >
                <tab.icon size={13} />
                {tab.label}
              </button>
            ))}
          </div>

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
                {!isEditingData ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                    <div className="col-span-1 md:col-span-2 flex items-center justify-between border-b border-clinic-border pb-2">
                      <div className="flex gap-4 items-center">
                        <PatientPhoto
                          patient={patient}
                          alt={patient.name}
                          onClick={hasPatientPhoto(patient) ? () => setIsPhotoExpanded(true) : undefined}
                          className="w-14 h-14 rounded-full object-cover border border-clinic-border/50 shadow-sm cursor-pointer hover:opacity-80 transition"
                          fallbackClassName="w-14 h-14 rounded-full bg-clinic-bg flex items-center justify-center border border-clinic-border/50 text-clinic-text-faint text-xl shadow-sm"
                          fallbackText={patient.name.charAt(0)}
                        />
                        <div className="flex-1">
                           <p className="text-lg font-bold text-clinic-text leading-tight">{patient.name}</p>
                           <p className="text-xs font-medium text-clinic-text-muted">{calculateAge(patient.birthDate)} anos</p>
                        </div>
                      </div>
                      <button onClick={() => { setEditForm(patient); setIsEditingData(true); }} className="text-clinic-primary hover:underline text-xs flex items-center gap-1 font-bold">
                        <Edit3 size={12} /> Editar
                      </button>
                    </div>

                    {/* Photo Lightbox */}
                    {isPhotoExpanded && hasPatientPhoto(patient) && (
                      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm shadow-2xl" onClick={() => setIsPhotoExpanded(false)}>
                        <PatientPhoto
                          patient={patient}
                          alt={`Foto ampliada de ${patient.name}`}
                          className="max-w-full max-h-full rounded-2xl object-cover shadow-2xl animate-in zoom-in-95 cursor-pointer"
                          fallbackClassName="hidden"
                        />
                        <button className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/80 transition-colors">
                          <X size={24} />
                        </button>
                      </div>
                    )}

                    <div className="space-y-3">
                      <h6 className="text-[10px] font-bold text-clinic-text-faint uppercase bg-clinic-border/30 px-2 py-0.5 rounded inline-block tracking-wider">Contato e Contrato</h6>
                      <div className="grid grid-cols-1 gap-1">
                        {[
                          { l: 'Responsável', v: patient.guardianName },
                          { l: 'Nascimento', v: safeFormatDate(patient.birthDate, 'dd/MM/yyyy') },
                          { l: 'WhatsApp', v: <a href={`https://wa.me/55${(patient.whatsapp || '').replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-clinic-primary hover:underline flex items-center gap-1 justify-end"><MessageCircle size={12}/>{patient.whatsapp}</a> },
                          { l: 'Dia/Hora Fixo', v: `${patient.fixedDay} - ${patient.fixedTime}` },
                          { l: 'Início', v: safeFormatDate(patient.startDate, 'dd/MM/yyyy') },
                          { l: 'Modalidade', v: patient.paymentModal },
                        ].map(item => (
                          <div key={item.l} className="flex justify-between text-sm py-1 border-b border-clinic-border/30">
                            <span className="text-clinic-text-faint font-bold text-[10px] uppercase">{item.l}</span>
                            <span className="text-clinic-text font-medium text-right max-w-[200px] truncate" title={item.v}>{item.v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h6 className="text-[10px] font-bold text-clinic-text-faint uppercase bg-clinic-border/30 px-2 py-0.5 rounded inline-block tracking-wider">Escolar e Clínico</h6>
                      <div className="grid grid-cols-1 gap-1">
                        {[
                          { l: 'Escola', v: patient.school || '-' },
                          { l: 'Ano Escolar', v: patient.grade || '-' },
                          { l: 'Turno', v: patient.shift || '-' },
                          { l: 'Médico', v: patient.doctorName || '-' },
                          { l: 'Medicação', v: patient.medication || '-' },
                        ].map(item => (
                          <div key={item.l} className="flex justify-between text-sm py-0.5 border-b border-clinic-border/30">
                            <span className="text-clinic-text-faint font-bold text-[10px] uppercase">{item.l}</span>
                            <span className="text-clinic-text font-medium text-right max-w-[200px] truncate" title={item.v}>{item.v}</span>
                          </div>
                        ))}
                      </div>
                      
                      <div className="pt-2">
                        <p className="text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Documentos da Criança</p>
                        <div className="space-y-1">
                          {patient.reportPdfUrl ? (
                            <a href={patient.reportPdfUrl} download="Relatorio.pdf" className="w-full flex items-center gap-2 justify-center py-1.5 px-3 bg-clinic-bg border border-clinic-border rounded text-xs font-bold text-clinic-primary hover:bg-clinic-border/40 transition shadow-sm">
                              <FileText size={14}/> Ver Relatório
                            </a>
                          ) : (
                             <p className="text-xs text-clinic-text-faint/60 italic py-0.5">Sem Relatório anexado</p>
                          )}
                          {patient.opinionPdfUrl ? (
                            <a href={patient.opinionPdfUrl} download="Parecer.pdf" className="w-full flex items-center gap-2 justify-center py-1.5 px-3 bg-clinic-bg border border-clinic-border rounded text-xs font-bold text-clinic-primary hover:bg-clinic-border/40 transition shadow-sm">
                              <FileText size={14}/> Ver Parecer
                            </a>
                          ) : (
                             <p className="text-xs text-clinic-text-faint/60 italic py-0.5 border-t border-clinic-border/10">Sem Parecer anexado</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="col-span-1 md:col-span-2 pt-2 border-t border-clinic-border space-y-2">
                      <h5 className="text-[15px] font-bold text-clinic-text">Histórico de Pacotes</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {packageHistory.filter(p => p.completed).length > 0 ? packageHistory.filter(p => p.completed).map(pkg => (
                          <div key={pkg.number} className="flex justify-between items-center text-sm py-2 px-3 border border-clinic-border/50 rounded-lg bg-clinic-bg/30 shadow-sm">
                            <span className="text-clinic-text font-bold text-xs uppercase tracking-wide">Pacote {pkg.number}</span>
                            <span className="text-[10px] font-medium text-clinic-text-muted bg-white/50 px-2 py-0.5 rounded">
                              {safeFormatDate(pkg.startDate, 'dd/MM')} a {safeFormatDate(pkg.endDate, 'dd/MM/yy')}
                            </span>
                          </div>
                        )) : (
                          <p className="col-span-full text-[10px] uppercase text-clinic-text-faint font-bold tracking-widest py-2">Nenhum pacote anterior finalizado</p>
                        )}
                      </div>
                    </div>
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
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-4">
                      {/* Column 1: Dados Pessoais */}
                      <div className="space-y-4">
                        <h4 className="text-base font-bold border-b border-clinic-border pb-2 flex items-center gap-2 text-clinic-text">
                          <Users size={16} className="text-clinic-primary" />
                          Dados Pessoais
                        </h4>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Nome da Criança</label>
                          <input type="text" value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Nascimento</label>
                            <input type="date" value={editForm.birthDate || ''} onChange={e => setEditForm({...editForm, birthDate: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Idade</label>
                            <div className="px-4 py-3 bg-clinic-bg/50 rounded-xl border border-clinic-border text-clinic-text-muted italic text-sm">
                              {editForm.birthDate ? `${calculateAge(editForm.birthDate)} anos` : '--'}
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Responsável</label>
                          <input type="text" value={editForm.guardianName || ''} onChange={e => setEditForm({...editForm, guardianName: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">WhatsApp</label>
                          <input type="text" value={editForm.whatsapp || ''} onChange={e => setEditForm({...editForm, whatsapp: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Foto da Criança</label>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={isSavingData}
                            onChange={e => handleFileUpload(e, 'photoUrl')}
                            className="px-4 py-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm block w-full text-clinic-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-clinic-primary/10 file:text-clinic-primary hover:file:bg-clinic-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                          {(pendingPhotoPreviewUrl || hasPatientPhoto(editForm)) && (
                            <div className="mt-2 flex items-center gap-3 rounded-xl border border-clinic-border bg-clinic-bg/50 p-2">
                              {pendingPhotoPreviewUrl ? (
                                <img
                                  src={pendingPhotoPreviewUrl}
                                  alt="Prévia da foto da criança"
                                  className="h-14 w-14 rounded-full border border-clinic-border object-cover"
                                />
                              ) : (
                                <PatientPhoto
                                  patient={{
                                    name: editForm.name || patient.name,
                                    photoUrl: editForm.photoUrl,
                                    photoDriveFileId: editForm.photoDriveFileId,
                                  }}
                                  alt="Foto atual da criança"
                                  className="h-14 w-14 rounded-full border border-clinic-border object-cover"
                                  fallbackClassName="h-14 w-14 rounded-full border border-clinic-border bg-clinic-bg flex items-center justify-center font-bold text-clinic-primary"
                                />
                              )}
                              <p className="text-xs text-clinic-text-muted">
                                {pendingPhotoPreviewUrl
                                  ? 'Nova foto selecionada. O envio ao Google Drive será concluído ao salvar as alterações.'
                                  : 'Foto atual salva de forma privada no Google Drive.'}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Column 2: Escolar e Clínico */}
                      <div className="space-y-4">
                        <h4 className="text-base font-bold border-b border-clinic-border pb-2 flex items-center gap-2 text-clinic-text">
                          <FileText size={16} className="text-clinic-primary" />
                          Escolar e Clínico
                        </h4>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Escola</label>
                          <input type="text" value={editForm.school || ''} onChange={e => setEditForm({...editForm, school: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Ano Escolar</label>
                            <input type="text" value={editForm.grade || ''} onChange={e => setEditForm({...editForm, grade: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Turno</label>
                            <select value={editForm.shift || ''} onChange={e => setEditForm({...editForm, shift: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full">
                              <option value="">-</option>
                              <option value="Manhã">Manhã</option>
                              <option value="Tarde">Tarde</option>
                              <option value="Integral">Integral</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Médico Cuidando</label>
                          <input type="text" value={editForm.doctorName || ''} onChange={e => setEditForm({...editForm, doctorName: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Medicação em Uso</label>
                          <input type="text" value={editForm.medication || ''} onChange={e => setEditForm({...editForm, medication: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div className="space-y-4 pt-2">
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Upload Relatório (PDF)</label>
                            <input type="file" accept="application/pdf" onChange={e => handleFileUpload(e, 'reportPdfUrl')} className="px-4 py-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm block w-full text-clinic-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-clinic-primary/10 file:text-clinic-primary hover:file:bg-clinic-primary/20" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Upload Parecer (PDF)</label>
                            <input type="file" accept="application/pdf" onChange={e => handleFileUpload(e, 'opinionPdfUrl')} className="px-4 py-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm block w-full text-clinic-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-clinic-primary/10 file:text-clinic-primary hover:file:bg-clinic-primary/20" />
                          </div>
                        </div>
                      </div>
                      
                      {/* Column 3: Configuração do Pacote e Status */}
                      <div className="space-y-4">
                        <h4 className="text-base font-bold border-b border-clinic-border pb-2 flex items-center gap-2 text-clinic-text">
                          <Clock size={16} className="text-clinic-primary" />
                          Configuração do Pacote
                        </h4>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Dia Fixo</label>
                            <select value={editForm.fixedDay || ''} onChange={e => setEditForm({...editForm, fixedDay: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full">
                              {AVAILABLE_DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Horário Fixo</label>
                            <select 
                              value={AVAILABLE_TIMES.includes(editForm.fixedTime || '') ? editForm.fixedTime : 'custom'}
                              onChange={e => {
                                if (e.target.value === 'custom') {
                                  setEditForm({...editForm, fixedTime: '17:30'});
                                } else {
                                  setEditForm({...editForm, fixedTime: e.target.value});
                                }
                              }}
                              className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full"
                            >
                              {AVAILABLE_TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                              <option value="custom">Outro horário...</option>
                            </select>
                            {(!editForm.fixedTime || !AVAILABLE_TIMES.includes(editForm.fixedTime)) && (
                              <input
                                type="text"
                                placeholder="Ex: 17:30"
                                value={editForm.fixedTime || ''}
                                onChange={e => setEditForm({...editForm, fixedTime: e.target.value})}
                                className="px-4 py-3 mt-2 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full animate-in fade-in slide-in-from-top-1"
                              />
                            )}
                          </div>
                        </div>
                        {/* Toggle Sessão Dupla */}
                        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl border border-clinic-border bg-clinic-bg hover:bg-clinic-primary/5 transition-all mt-2">
                          <div className="relative">
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={!!editForm.doubleSession}
                              onChange={e => setEditForm({...editForm, doubleSession: e.target.checked})}
                            />
                            <div className={`w-10 h-6 rounded-full transition-colors ${editForm.doubleSession ? 'bg-clinic-primary' : 'bg-clinic-border'}`}>
                              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${editForm.doubleSession ? 'translate-x-5' : 'translate-x-1'}`} />
                            </div>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-clinic-text">Sessão Dupla (2 × 50 min)</p>
                            <p className="text-[10px] text-clinic-text-muted">Ocupa dois horários consecutivos na agenda</p>
                          </div>
                        </label>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Modalidade de Pagamento</label>
                          <select value={editForm.paymentModal || ''} onChange={e => setEditForm({...editForm, paymentModal: e.target.value as PaymentModal})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full">
                            <option value={PaymentModal.PIX_FULL}>{PaymentModal.PIX_FULL}</option>
                            <option value={PaymentModal.PARCELADO}>{PaymentModal.PARCELADO}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Início do Pacote</label>
                          <input type="date" value={editForm.startDate || ''} onChange={e => setEditForm({...editForm, startDate: e.target.value})} className="px-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full" />
                        </div>
                        <div className="pt-4 mt-2 border-t border-clinic-border">
                          <label className="block text-[10px] font-bold text-clinic-text-faint uppercase mb-1">Status do Atendente</label>
                          <select value={editForm.status || 'Ativo'} onChange={e => setEditForm({...editForm, status: e.target.value as 'Ativo' | 'Concluído'})} className={`px-4 py-3 rounded-xl border border-clinic-border outline-none focus:ring-2 focus:ring-clinic-primary transition-all text-sm w-full font-bold ${editForm.status === 'Concluído' ? 'bg-status-red-bg text-status-red-text' : 'bg-status-green-bg text-status-green-text'}`}>
                            <option value="Ativo">🟢 Ativo</option>
                            <option value="Concluído">🔴 Concluído (Inativo)</option>
                          </select>
                          {editForm.status === 'Concluído' && patient.status !== 'Concluído' && (
                            <p className="text-[10px] text-status-red-text mt-2 font-medium bg-red-50 p-2 rounded">
                              Atenção: Ao salvar como Concluído, todas as sessões e reposições futuras agendadas serão automaticamente excluídas.
                            </p>
                          )}
                        </div>
                      </div>
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
                   {patientSessions.length > 0 ? (
                     patientSessions.map(session => (
                       <div key={session.id} className={cn(
                         "p-4 rounded-xl border flex items-center justify-between",
                         session.status === SessionStatus.REALIZADA ? 'bg-blue-500/10 border-blue-400 border-dashed' :
                         session.status === SessionStatus.FALTA ? 'bg-red-500/10 border-red-500/20' :
                         session.status === SessionStatus.FALTA_PROF ? 'bg-orange-500/10 border-orange-500/20' :
                         'bg-transparent border-clinic-border'
                       )}>
                         <div className="flex items-center gap-4">
                            <Calendar size={18} className="text-clinic-text-faint" />
                            <div className="flex flex-col">
                              <span className="font-bold text-sm">{safeFormatDate(session.date, 'dd/MM/yyyy')} — {session.time}</span>
                              <span className="text-[10px] text-clinic-text-muted italic">{session.type}</span>
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
                             </div>
                             <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", getStatusColor(session.status))}>
                              {session.status}
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
                              <span className="text-clinic-text-faint font-bold uppercase tracking-wider text-[10px]">Sessões Realizadas</span>
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
                      <span className="block text-[10px] font-bold uppercase">Total Pago</span>
                      <span className="text-2xl font-bold">{formatCurrency(patientPayments.reduce((s, p) => s + p.amount, 0))}</span>
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
                                    <span className="font-bold text-sm">{formatCurrency(payment.amount)} — {payment.installment}</span>
                                    <span className="text-[10px] text-clinic-text-muted">{safeFormatDate(payment.date, 'dd/MM/yyyy')} via {payment.method}</span>
                                  </div>
                               </div>
                               <div className="flex items-center gap-2">
                                  <button onClick={() => handleEditPaymentClick(payment)} className="p-1.5 text-clinic-text-muted hover:text-clinic-primary hover:bg-clinic-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Editar Pagamento">
                                     <Edit3 size={14} />
                                  </button>
                                  <button onClick={() => handleDeletePaymentClick(payment.id)} className="p-1.5 text-clinic-text-muted hover:text-status-red-text hover:bg-status-red-bg rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Excluir Pagamento">
                                     <Trash2 size={14} />
                                  </button>
                                  <span className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-status-green-bg text-status-green-text">Recebido</span>
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
                className="px-4 py-2 bg-status-green-bg text-status-green-text font-bold rounded-lg hover:bg-green-200 transition-all uppercase tracking-wide text-xs"
              >
                Confirmar Recebimento
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
  );
}


