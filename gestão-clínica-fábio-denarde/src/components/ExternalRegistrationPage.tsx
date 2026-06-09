import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, CheckCircle, Loader2, Send, Users } from 'lucide-react';
import { db } from '../firebase';
import { ExternalRegistrationData, ExternalRegistrationForm } from '../types';
import { calculateAge, cn } from '../lib/utils';
import {
  EMPTY_EXTERNAL_REGISTRATION_DATA,
  formatBrazilianWhatsapp,
  patientToExternalRegistrationData,
  sanitizeForFirestore,
  validateExternalRegistrationData,
} from '../lib/externalRegistration';

const SHIFT_OPTIONS = ['Matutino', 'Vespertino', 'Integral', 'Noturno', 'Outro'];

export default function ExternalRegistrationPage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formRecord, setFormRecord] = useState<ExternalRegistrationForm | null>(null);
  const [formData, setFormData] = useState<ExternalRegistrationData>(EMPTY_EXTERNAL_REGISTRATION_DATA);
  const [errors, setErrors] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const [friendlyError, setFriendlyError] = useState('');

  useEffect(() => {
    async function loadForm() {
      try {
        const ref = doc(db, 'externalRegistrationForms', token);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setFriendlyError('Link inválido. Confira se o endereço foi copiado corretamente.');
          return;
        }

        const record = snap.data() as ExternalRegistrationForm;
        const now = new Date();
        const expiresAt = new Date(record.expiresAt);
        if (Number.isNaN(expiresAt.getTime()) || expiresAt < now) {
          setFriendlyError('Este link expirou. Solicite um novo link para a clínica.');
          return;
        }

        if (record.status === 'Novo cadastro criado' || record.status === 'Cadastro atualizado' || record.status === 'Arquivado') {
          setFriendlyError('Este formulário já foi finalizado pela clínica.');
          return;
        }

        setFormRecord(record);
        setFormData({
          ...patientToExternalRegistrationData(record.patientSnapshot),
          ...(record.submittedData || record.currentData || {}),
          authorizationAccepted: record.submittedData?.authorizationAccepted || false,
        });
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
        console.error(`Erro ao abrir formulário externo pelo token (${code}). Verifique Firestore Rules para get público em externalRegistrationForms/{token}.`, error);
        setFriendlyError('Não foi possível abrir o formulário agora. Tente novamente em instantes.');
      } finally {
        setLoading(false);
      }
    }

    loadForm();
  }, [token]);

  const pageTitle = useMemo(() => {
    if (!formRecord) return 'Pré-cadastro';
    return formRecord.type === 'update' ? 'Conferência de dados cadastrais' : 'Pré-cadastro da criança';
  }, [formRecord]);

  const updateField = <K extends keyof ExternalRegistrationData>(key: K, value: ExternalRegistrationData[K]) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formRecord) return;

    const nextErrors = validateExternalRegistrationData(formData);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'externalRegistrationForms', token), sanitizeForFirestore({
        submittedData: {
          ...formData,
          whatsapp: formatBrazilianWhatsapp(formData.whatsapp),
          doctorName: formData.hasMedicalFollowUp === 'Sim' ? formData.doctorName || '' : '',
          medication: formData.usesMedication === 'Sim' ? formData.medication || '' : '',
        },
        submittedAt: now,
        status: formRecord.type === 'update' ? 'Atualização recebida' : 'Pré-cadastro recebido',
      }));
      setSent(true);
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'unknown';
      console.error(`Erro ao enviar formulário externo (${code}). Verifique Firestore Rules para update público restrito em externalRegistrationForms/{token}.`, error);
      setErrors(['Não foi possível enviar agora. Verifique sua conexão e tente novamente.']);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-clinic-bg flex items-center justify-center p-4">
        <Loader2 className="w-10 h-10 text-clinic-primary animate-spin" />
      </div>
    );
  }

  if (friendlyError) {
    return (
      <div className="min-h-screen bg-clinic-bg flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-clinic-surface border border-clinic-border rounded-2xl p-6 shadow-clinic text-center">
          <AlertTriangle className="w-10 h-10 text-status-orange-text mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-clinic-text mb-2">Link indisponível</h1>
          <p className="text-sm text-clinic-text-muted">{friendlyError}</p>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-clinic-bg flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-clinic-surface border border-clinic-border rounded-2xl p-6 shadow-clinic text-center">
          <CheckCircle className="w-12 h-12 text-status-green-text mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-clinic-text mb-3">Cadastro enviado com sucesso.</h1>
          <p className="text-sm text-clinic-text-muted leading-relaxed">
            As informações serão conferidas pela clínica. Caso seja necessário, entraremos em contato pelo WhatsApp informado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-clinic-bg py-5 px-3 sm:px-4">
      <form onSubmit={handleSubmit} className="max-w-3xl mx-auto bg-clinic-surface border border-clinic-border rounded-2xl shadow-clinic overflow-hidden">
        <header className="bg-clinic-header text-white p-5">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-3 rounded-xl">
              <Users size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{pageTitle}</h1>
              <p className="text-xs text-white/75 font-bold uppercase tracking-wider">Gestão Clínica Neuropsicopedagógica</p>
            </div>
          </div>
        </header>

        <main className="p-4 sm:p-6 space-y-6">
          {errors.length > 0 && (
            <div className="bg-status-red-bg border border-status-red-text/20 rounded-xl p-4 text-sm text-status-red-text font-bold space-y-1">
              {errors.map(error => <p key={error}>{error}</p>)}
            </div>
          )}

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-clinic-text border-b border-clinic-border pb-2">Dados Pessoais</h2>
            <Field label="Nome da criança *">
              <input value={formData.name} onChange={e => updateField('name', e.target.value)} className="clinic-input" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Nascimento *">
                <input type="date" value={formData.birthDate} onChange={e => updateField('birthDate', e.target.value)} className="clinic-input" />
              </Field>
              <Field label="Idade estimada">
                <div className="clinic-input bg-clinic-bg/50 text-clinic-text-muted italic">
                  {formData.birthDate ? `${calculateAge(formData.birthDate)} anos` : '--'}
                </div>
              </Field>
            </div>
            <Field label="Responsável *">
              <input value={formData.guardianName} onChange={e => updateField('guardianName', e.target.value)} className="clinic-input" />
            </Field>
            <Field label="WhatsApp *">
              <input
                inputMode="tel"
                value={formData.whatsapp}
                onChange={e => updateField('whatsapp', formatBrazilianWhatsapp(e.target.value))}
                placeholder="(27) 99999-0000"
                className="clinic-input"
              />
            </Field>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-clinic-text border-b border-clinic-border pb-2">Escolar e Clínico</h2>
            <Field label="Escola">
              <input value={formData.school || ''} onChange={e => updateField('school', e.target.value)} className="clinic-input" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Ano escolar">
                <input value={formData.grade || ''} onChange={e => updateField('grade', e.target.value)} className="clinic-input" />
              </Field>
              <Field label="Turno">
                <select value={formData.shift || ''} onChange={e => updateField('shift', e.target.value)} className="clinic-input">
                  <option value="">Selecione</option>
                  {SHIFT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </Field>
            </div>

            <YesNoQuestion
              label="Faz acompanhamento médico atualmente?"
              value={formData.hasMedicalFollowUp}
              onChange={value => updateField('hasMedicalFollowUp', value)}
            />
            {formData.hasMedicalFollowUp === 'Sim' && (
              <Field label="Médico cuidando">
                <input value={formData.doctorName || ''} onChange={e => updateField('doctorName', e.target.value)} className="clinic-input" />
              </Field>
            )}

            <YesNoQuestion
              label="Usa medicação atualmente?"
              value={formData.usesMedication}
              onChange={value => updateField('usesMedication', value)}
            />
            {formData.usesMedication === 'Sim' && (
              <Field label="Medicação em uso">
                <input value={formData.medication || ''} onChange={e => updateField('medication', e.target.value)} className="clinic-input" />
              </Field>
            )}
          </section>

          <label className="flex items-start gap-3 p-4 bg-clinic-bg border border-clinic-border rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={formData.authorizationAccepted}
              onChange={e => updateField('authorizationAccepted', e.target.checked)}
              className="mt-1 w-4 h-4 accent-clinic-primary"
            />
            <span className="text-sm text-clinic-text font-medium leading-relaxed">
              Confirmo que as informações preenchidas são verdadeiras e autorizo o uso desses dados pela clínica para fins de cadastro e acompanhamento neuropsicopedagógico.
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-4 bg-clinic-primary text-white font-bold rounded-xl shadow-lg hover:bg-clinic-primary-hover transition-all uppercase tracking-widest disabled:opacity-60"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            Enviar cadastro
          </button>
        </main>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold text-clinic-text-faint uppercase">{label}</span>
      {children}
    </label>
  );
}

function YesNoQuestion({ label, value, onChange }: { label: string; value: 'Sim' | 'Não' | ''; onChange: (value: 'Sim' | 'Não') => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-clinic-text-faint uppercase">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        {(['Sim', 'Não'] as const).map(option => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              'py-3 rounded-xl border text-sm font-bold transition-all',
              value === option
                ? 'bg-clinic-primary text-white border-clinic-primary shadow-sm'
                : 'bg-clinic-bg text-clinic-text-muted border-clinic-border'
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
