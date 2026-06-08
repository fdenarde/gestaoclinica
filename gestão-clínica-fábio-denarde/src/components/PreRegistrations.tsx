import React, { useMemo, useState } from 'react';
import { Archive, CheckCircle, ClipboardList, FileText, Search, Trash2, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { AppState, ExternalRegistrationForm, Patient, PaymentModal, ExternalRegistrationHistoryItem, ExternalRegistrationStatus } from '../types';
import Modal from './Common/Modal';
import { showToast } from './Common/Toast';
import { calculateAge, cn, safeFormatDate } from '../lib/utils';
import {
  EXTERNAL_REGISTRATION_FIELDS,
  externalRegistrationDataToPatient,
  getChangedExternalFields,
  getExternalFieldLabel,
  isFinalExternalRegistrationStatus,
  isPendingExternalRegistrationStatus,
} from '../lib/externalRegistration';

interface PreRegistrationsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
  currentUserName: string;
  onNavigateToPatient?: (patientId: string) => void;
}

type RegistrationFilter = 'all' | 'pending' | 'fill-pending' | 'received-updates' | 'created-updated' | 'archived';

const FILTER_OPTIONS: { id: RegistrationFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'fill-pending', label: 'Pendente de preenchimento' },
  { id: 'received-updates', label: 'Atualizações recebidas' },
  { id: 'created-updated', label: 'Criados/Atualizados' },
  { id: 'archived', label: 'Arquivados' },
];

export default function PreRegistrations({ state, onUpdate, currentUserName, onNavigateToPatient }: PreRegistrationsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<RegistrationFilter>('all');
  const [hideFinalized, setHideFinalized] = useState(true);
  const [formToDelete, setFormToDelete] = useState<ExternalRegistrationForm | null>(null);

  const forms = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    return [...(state.externalRegistrationForms || [])]
      .filter(form => {
        const data = form.submittedData || form.currentData;
        if (hideFinalized && activeFilter === 'all' && isFinalExternalRegistrationStatus(form.status)) return false;
        if (!matchesRegistrationFilter(form.status, activeFilter)) return false;
        if (!normalized) return true;
        return [data?.name, data?.guardianName, data?.whatsapp, form.status].some(value =>
          String(value || '').toLowerCase().includes(normalized)
        );
      })
      .sort((a, b) => String(b.submittedAt || b.createdAt).localeCompare(String(a.submittedAt || a.createdAt)));
  }, [state.externalRegistrationForms, searchTerm, activeFilter, hideFinalized]);

  const selectedForm = forms.find(form => form.id === selectedFormId) || null;
  const selectedPatient = selectedForm?.patientId ? state.patients.find(patient => patient.id === selectedForm.patientId) : undefined;
  const comparisonCurrent = selectedPatient ? {
    name: selectedPatient.name,
    birthDate: selectedPatient.birthDate,
    guardianName: selectedPatient.guardianName,
    whatsapp: selectedPatient.whatsapp,
    school: selectedPatient.school || '',
    grade: selectedPatient.grade || '',
    shift: selectedPatient.shift || '',
    hasMedicalFollowUp: selectedPatient.doctorName ? 'Sim' as const : 'Não' as const,
    doctorName: selectedPatient.doctorName || '',
    usesMedication: selectedPatient.medication ? 'Sim' as const : 'Não' as const,
    medication: selectedPatient.medication || '',
    authorizationAccepted: true,
  } : selectedForm?.currentData;
  const changedFields = selectedForm?.submittedData && comparisonCurrent
    ? getChangedExternalFields(comparisonCurrent, selectedForm.submittedData)
    : [];

  const openForm = (form: ExternalRegistrationForm) => {
    const patientForForm = form.patientId ? state.patients.find(patient => patient.id === form.patientId) : undefined;
    const currentForForm = patientForForm ? {
      name: patientForForm.name,
      birthDate: patientForForm.birthDate,
      guardianName: patientForForm.guardianName,
      whatsapp: patientForForm.whatsapp,
      school: patientForForm.school || '',
      grade: patientForForm.grade || '',
      shift: patientForForm.shift || '',
      hasMedicalFollowUp: patientForForm.doctorName ? 'Sim' as const : 'Não' as const,
      doctorName: patientForForm.doctorName || '',
      usesMedication: patientForForm.medication ? 'Sim' as const : 'Não' as const,
      medication: patientForForm.medication || '',
      authorizationAccepted: true,
    } : form.currentData;
    setSelectedFormId(form.id);
    setSelectedFields(form.submittedData && currentForForm ? getChangedExternalFields(currentForForm, form.submittedData) : []);
  };

  const updateForm = (form: ExternalRegistrationForm) => {
    onUpdate({
      externalRegistrationForms: (state.externalRegistrationForms || []).map(item => item.id === form.id ? form : item)
    });
  };

  const archiveForm = (form: ExternalRegistrationForm) => {
    updateForm({
      ...form,
      status: 'Arquivado',
      archivedAt: new Date().toISOString(),
      reviewedAt: new Date().toISOString(),
      reviewedBy: currentUserName,
    });
    showToast('Formulário arquivado.');
    setSelectedFormId(null);
  };

  const deleteExternalForm = () => {
    if (!formToDelete) return;
    onUpdate({
      externalRegistrationForms: (state.externalRegistrationForms || []).filter(item => item.id !== formToDelete.id)
    });
    showToast('Formulário externo excluído.', 'success');
    if (selectedFormId === formToDelete.id) {
      setSelectedFormId(null);
    }
    setFormToDelete(null);
  };

  const createPatientFromForm = (form: ExternalRegistrationForm) => {
    if (!form.submittedData) return;
    const patientData = externalRegistrationDataToPatient(form.submittedData);
    const patientId = Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();
    const history = createHistory(form, now, 'Criar novo cadastro', Object.keys(patientData));
    const patient: Patient = {
      id: patientId,
      name: patientData.name || '',
      birthDate: patientData.birthDate || '',
      guardianName: patientData.guardianName || '',
      whatsapp: patientData.whatsapp || '',
      school: patientData.school || '',
      grade: patientData.grade || '',
      shift: patientData.shift || '',
      doctorName: patientData.doctorName || '',
      medication: patientData.medication || '',
      fixedDay: 'terça',
      fixedTime: '08:00',
      paymentModal: PaymentModal.PIX_FULL,
      startDate: format(new Date(), 'yyyy-MM-dd'),
      anamnese: {
        complaint: '',
        school: patientData.school || '',
        grade: patientData.grade || '',
        referredBy: 'Pré-cadastro externo',
        diagnoses: '',
        initialNotes: 'Cadastro criado a partir de formulário preenchido pelo responsável.'
      },
      clinicalNotes: '',
      status: 'Ativo',
      lastExternalRegistrationUpdate: now,
      externalRegistrationHistory: [history],
    };

    onUpdate({
      patients: [...state.patients, patient],
      externalRegistrationForms: (state.externalRegistrationForms || []).map(item =>
        item.id === form.id
          ? { ...item, status: 'Novo cadastro criado', patientId, reviewedAt: now, reviewedBy: currentUserName, history: [...(item.history || []), history] }
          : item
      )
    });
    showToast('Cadastro criado a partir do pré-cadastro.', 'success');
    setSelectedFormId(null);
    onNavigateToPatient?.(patientId);
  };

  const updatePatientFromForm = (form: ExternalRegistrationForm, mode: 'all' | 'empty' | 'selected') => {
    if (!form.submittedData || !form.patientId) return;
    const patient = state.patients.find(item => item.id === form.patientId);
    if (!patient) {
      showToast('Cadastro vinculado não encontrado.', 'error');
      return;
    }

    const submittedPatientData = externalRegistrationDataToPatient(form.submittedData);
    const fieldsToUpdate = (Object.keys(submittedPatientData) as (keyof Patient)[]).filter(field => {
      if (mode === 'all') return true;
      if (mode === 'empty') return !String(patient[field] || '').trim() && !!String(submittedPatientData[field] || '').trim();
      return selectedFields.includes(String(field));
    });

    const now = new Date().toISOString();
    const updatedPatient = fieldsToUpdate.reduce((acc, field) => ({
      ...acc,
      [field]: submittedPatientData[field],
    }), { ...patient } as Patient);
    updatedPatient.lastExternalRegistrationUpdate = now;
    updatedPatient.externalRegistrationHistory = [
      ...(patient.externalRegistrationHistory || []),
      createHistory(form, now, mode === 'all' ? 'Atualizar todos os campos' : mode === 'empty' ? 'Atualizar campos vazios' : 'Atualizar campos selecionados', fieldsToUpdate.map(String))
    ];

    onUpdate({
      patients: state.patients.map(item => item.id === patient.id ? updatedPatient : item),
      externalRegistrationForms: (state.externalRegistrationForms || []).map(item =>
        item.id === form.id
          ? { ...item, status: 'Cadastro atualizado', reviewedAt: now, reviewedBy: currentUserName }
          : item
      )
    });
    showToast('Cadastro atualizado após revisão.', 'success');
    setSelectedFormId(null);
    onNavigateToPatient?.(patient.id);
  };

  const createHistory = (form: ExternalRegistrationForm, approvedAt: string, action: string, changed: string[]): ExternalRegistrationHistoryItem => ({
    id: Math.random().toString(36).substr(2, 9),
    formId: form.id,
    submittedAt: form.submittedAt || '',
    approvedAt,
    type: form.type,
    action,
    changedFields: changed,
    approvedBy: currentUserName,
  });

  const pendingCount = (state.externalRegistrationForms || []).filter(form => isPendingExternalRegistrationStatus(form.status)).length;

  return (
    <div className="space-y-6 pb-10">
      <section className="bg-status-orange-bg border border-status-orange-text/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="text-status-orange-text" size={22} />
          <div>
            <h2 className="font-serif text-xl font-bold text-clinic-text">Formulários recebidos</h2>
            <p className="text-sm text-clinic-text-muted">{pendingCount} pendente(s) de revisão manual.</p>
          </div>
        </div>
      </section>

      <div className="bg-clinic-surface border border-clinic-border rounded-2xl p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
          <div className="relative max-w-lg w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={18} />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar por criança, responsável, WhatsApp ou status..."
              className="w-full pl-10 pr-4 py-3 bg-clinic-bg rounded-xl border border-clinic-border focus:ring-2 focus:ring-clinic-primary outline-none text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-black uppercase text-clinic-text-muted select-none">
            <input
              type="checkbox"
              checked={hideFinalized}
              onChange={e => setHideFinalized(e.target.checked)}
              className="accent-clinic-primary"
            />
            Ocultar arquivados e finalizados
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTER_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => setActiveFilter(option.id)}
              className={cn(
                'px-3 py-2 rounded-full border text-[10px] font-black uppercase transition-colors',
                activeFilter === option.id
                  ? 'bg-clinic-header text-white border-clinic-header'
                  : 'bg-clinic-bg text-clinic-text-muted border-clinic-border hover:text-clinic-text'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-clinic-surface border border-clinic-border rounded-2xl shadow-sm overflow-hidden responsive-table">
        <table className="w-full text-sm">
          <thead className="bg-clinic-bg text-clinic-text-faint uppercase text-[10px] font-black">
            <tr>
              <th className="p-3 text-left">Criança</th>
              <th className="p-3 text-left">Responsável</th>
              <th className="p-3 text-left">WhatsApp</th>
              <th className="p-3 text-left">Nascimento</th>
              <th className="p-3 text-left">Envio</th>
              <th className="p-3 text-left">Tipo</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {forms.map(form => {
              const data = form.submittedData || form.currentData;
              return (
                <tr key={form.id} className="border-t border-clinic-border">
                  <td data-label="Criança" className="p-3 font-bold text-clinic-text">{data?.name || '-'}</td>
                  <td data-label="Responsável" className="p-3">{data?.guardianName || '-'}</td>
                  <td data-label="WhatsApp" className="p-3">{data?.whatsapp || '-'}</td>
                  <td data-label="Nascimento" className="p-3">{data?.birthDate ? safeFormatDate(data.birthDate, 'dd/MM/yyyy') : '-'}</td>
                  <td data-label="Envio" className="p-3">{form.submittedAt ? safeFormatDate(form.submittedAt, 'dd/MM/yyyy HH:mm') : '-'}</td>
                  <td data-label="Tipo" className="p-3">{form.type === 'new' ? 'Novo pré-cadastro' : 'Atualização existente'}</td>
                  <td data-label="Status" className="p-3">
                    <span className={cn('px-2 py-1 rounded-full text-[10px] font-black uppercase', form.status.includes('receb') ? 'bg-status-orange-bg text-status-orange-text' : 'bg-clinic-bg text-clinic-text-muted')}>
                      {form.status}
                    </span>
                  </td>
                  <td data-label="Ações" className="p-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button onClick={() => openForm(form)} className="px-3 py-2 bg-clinic-header text-white rounded-lg text-[10px] font-bold uppercase inline-flex items-center gap-1">
                        <FileText size={13} /> Ver detalhes
                      </button>
                      <button
                        onClick={() => setFormToDelete(form)}
                        className="px-3 py-2 bg-status-red-bg text-status-red-text border border-status-red-text/20 rounded-lg text-[10px] font-bold uppercase inline-flex items-center gap-1 hover:bg-status-red-text hover:text-white transition-colors"
                        title="Excluir formulário externo"
                      >
                        <Trash2 size={13} /> Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {forms.length === 0 && (
              <tr>
                <td colSpan={8} className="p-10 text-center text-clinic-text-muted italic">Nenhum formulário encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedForm && !formToDelete && (
        <Modal isOpen={true} onClose={() => setSelectedFormId(null)} title="Revisar formulário recebido" width="max-w-5xl">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Info label="Tipo" value={selectedForm.type === 'new' ? 'Novo pré-cadastro' : 'Atualização de cadastro existente'} />
              <Info label="Status" value={selectedForm.status} />
              <Info label="Enviado em" value={selectedForm.submittedAt ? safeFormatDate(selectedForm.submittedAt, 'dd/MM/yyyy HH:mm') : 'Ainda não enviado'} />
            </div>

            {selectedForm.type === 'new' ? (
              <DataCard title="Dados enviados" data={selectedForm.submittedData} />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <DataCard title="Dados atuais do sistema" data={comparisonCurrent} />
                <DataCard title="Dados enviados pelo responsável" data={selectedForm.submittedData} highlightKeys={changedFields} />
              </div>
            )}

            {selectedForm.type === 'update' && changedFields.length > 0 && (
              <div className="bg-clinic-bg border border-clinic-border rounded-xl p-4 space-y-3">
                <h4 className="font-serif font-bold text-clinic-text">Campos alterados</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {changedFields.map(field => (
                    <label key={field} className="flex items-center gap-2 text-sm font-bold text-clinic-text">
                      <input
                        type="checkbox"
                        checked={selectedFields.includes(field)}
                        onChange={e => setSelectedFields(prev => e.target.checked ? [...prev, field] : prev.filter(item => item !== field))}
                        className="accent-clinic-primary"
                      />
                      {getExternalFieldLabel(field)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row flex-wrap justify-end gap-3 border-t border-clinic-border pt-4">
              <button onClick={() => setFormToDelete(selectedForm)} className="px-4 py-2 bg-status-red-bg text-status-red-text border border-status-red-text/20 rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2">
                <Trash2 size={15} /> Excluir formulário
              </button>
              <button onClick={() => archiveForm(selectedForm)} className="px-4 py-2 bg-clinic-bg text-clinic-text-muted border border-clinic-border rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2">
                <Archive size={15} /> Arquivar
              </button>
              {selectedForm.type === 'new' && selectedForm.submittedData && (
                <button onClick={() => createPatientFromForm(selectedForm)} className="px-4 py-2 bg-clinic-primary text-white rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2">
                  <UserPlus size={15} /> Criar cadastro
                </button>
              )}
              {selectedForm.type === 'update' && selectedForm.submittedData && (
                <>
                  <button onClick={() => updatePatientFromForm(selectedForm, 'empty')} className="px-4 py-2 bg-status-blue-bg text-status-blue-text rounded-lg font-bold text-xs uppercase">
                    Atualizar campos vazios
                  </button>
                  <button onClick={() => updatePatientFromForm(selectedForm, 'selected')} className="px-4 py-2 bg-status-orange-bg text-status-orange-text rounded-lg font-bold text-xs uppercase">
                    Atualizar selecionados
                  </button>
                  <button onClick={() => updatePatientFromForm(selectedForm, 'all')} className="px-4 py-2 bg-clinic-primary text-white rounded-lg font-bold text-xs uppercase flex items-center justify-center gap-2">
                    <CheckCircle size={15} /> Atualizar todos
                  </button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}

      {formToDelete && (
        <Modal isOpen={true} onClose={() => setFormToDelete(null)} title="Excluir formulário recebido" width="max-w-md">
          <div className="space-y-5">
            <div className="bg-status-red-bg border border-status-red-text/20 rounded-xl p-4 text-sm text-clinic-text space-y-3">
              <p className="font-bold">Tem certeza que deseja excluir este formulário recebido?</p>
              <p>
                Esta ação apagará apenas o registro do formulário externo em Pré-cadastros.
                Nenhum cadastro de atendente/paciente, agenda, sessão, pagamento ou pacote será apagado.
              </p>
            </div>
            <div className="bg-clinic-bg border border-clinic-border rounded-xl p-3">
              <p className="text-[10px] font-black uppercase text-clinic-text-faint">Formulário</p>
              <p className="text-sm font-bold text-clinic-text">
                {(formToDelete.submittedData || formToDelete.currentData)?.name || 'Sem nome informado'}
              </p>
              <p className="text-xs text-clinic-text-muted">
                {(formToDelete.submittedData || formToDelete.currentData)?.guardianName || 'Responsável não informado'} · {formToDelete.status}
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setFormToDelete(null)} className="px-4 py-2 bg-clinic-bg text-clinic-text-muted border border-clinic-border rounded-lg font-bold text-xs uppercase">
                Cancelar
              </button>
              <button onClick={deleteExternalForm} className="px-4 py-2 bg-status-red-text text-white rounded-lg font-bold text-xs uppercase inline-flex items-center gap-2">
                <Trash2 size={15} /> Excluir formulário
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function matchesRegistrationFilter(status: ExternalRegistrationStatus, filter: RegistrationFilter) {
  if (filter === 'all') return true;
  if (filter === 'pending') return isPendingExternalRegistrationStatus(status);
  if (filter === 'fill-pending') return status === 'Pendente de preenchimento';
  if (filter === 'received-updates') return status === 'Atualização recebida';
  if (filter === 'created-updated') return status === 'Novo cadastro criado' || status === 'Cadastro atualizado';
  return status === 'Arquivado';
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-clinic-bg border border-clinic-border rounded-xl p-3">
      <p className="text-[10px] font-black uppercase text-clinic-text-faint">{label}</p>
      <p className="text-sm font-bold text-clinic-text">{value}</p>
    </div>
  );
}

function DataCard({ title, data, highlightKeys = [] }: { title: string; data?: Record<string, any>; highlightKeys?: string[] }) {
  return (
    <div className="bg-clinic-surface border border-clinic-border rounded-xl p-4 shadow-sm">
      <h4 className="font-serif font-bold text-clinic-text mb-3">{title}</h4>
      <div className="space-y-1">
        {EXTERNAL_REGISTRATION_FIELDS.map(field => (
          <div key={field.key} className={cn('flex justify-between gap-4 border-b border-clinic-border/40 py-1.5 text-sm', highlightKeys.includes(field.key) && 'bg-status-orange-bg/60 rounded px-2')}>
            <span className="text-clinic-text-faint text-[10px] font-black uppercase">{field.label}</span>
            <span className="font-bold text-clinic-text text-right">
              {field.key === 'birthDate' && data?.[field.key]
                ? `${safeFormatDate(data[field.key], 'dd/MM/yyyy')} (${calculateAge(data[field.key])} anos)`
                : data?.[field.key] || '-'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
