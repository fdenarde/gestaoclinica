import React from 'react';
import {
  BriefcaseBusiness,
  ChevronDown,
  GraduationCap,
  HeartHandshake,
  Phone,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import type { PatientRegistrationData } from '../../types';
import {
  PATIENT_CARE_SPECIALTY_OPTIONS,
  PATIENT_CUSTODY_STATUS_OPTIONS,
  PATIENT_EDUCATION_OPTIONS,
  PATIENT_FAMILY_STATUS_OPTIONS,
  PATIENT_FINANCIAL_RESPONSIBLE_OPTIONS,
  PATIENT_SEX_OPTIONS,
  PATIENT_SHIFT_OPTIONS,
  createPatientCareProfessional,
  formatPatientRegistrationValue,
  getEducationDetailLabel,
  getFirstName,
} from '../../lib/patientRegistration';

interface PatientRegistrationFieldsProps {
  value: Partial<PatientRegistrationData>;
  onChange: (patch: Partial<PatientRegistrationData>) => void;
  disabled?: boolean;
  requiredCore?: boolean;
  showClinicalFields?: boolean;
}

const inputClass = 'w-full rounded-xl border border-clinic-border bg-clinic-bg px-3 py-3 text-sm text-clinic-text outline-none transition focus:ring-2 focus:ring-clinic-primary disabled:cursor-not-allowed disabled:opacity-60';
const labelClass = 'mb-1 block text-[10px] font-black uppercase tracking-wide text-clinic-text-faint';
const panelClass = 'rounded-2xl border border-clinic-border bg-white/80 shadow-sm overflow-hidden';
const panelSummaryClass = 'group flex cursor-pointer list-none items-center justify-between gap-3 border-b border-clinic-border bg-gradient-to-r from-white to-clinic-bg/70 px-4 py-3 text-clinic-text [&::-webkit-details-marker]:hidden';
const sectionBodyClass = 'p-4';

function compactValue(value?: unknown, fallback = 'Não informado') {
  const text = String(value || '').trim();
  return text || fallback;
}

function DetailsPanel({
  title,
  icon,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  summary?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className={panelClass} open={defaultOpen}>
      <summary className={panelSummaryClass}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-clinic-primary/10 text-clinic-primary">{icon}</span>
          <div className="min-w-0">
            <h4 className="text-sm font-black text-clinic-text sm:text-base">{title}</h4>
            {summary && <p className="truncate text-[11px] font-semibold text-clinic-text-muted">{summary}</p>}
          </div>
        </div>
        <ChevronDown size={18} className="shrink-0 text-clinic-text-muted transition group-open:rotate-180" />
      </summary>
      <div className={sectionBodyClass}>{children}</div>
    </details>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-clinic-border bg-clinic-bg/45 p-3">
      <h5 className="mb-3 text-[11px] font-black uppercase tracking-wide text-clinic-primary">{title}</h5>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export default function PatientRegistrationFields({
  value,
  onChange,
  disabled = false,
  requiredCore = false,
  showClinicalFields = true,
}: PatientRegistrationFieldsProps) {
  const careProfessionals = Array.isArray(value.careProfessionals) ? value.careProfessionals : [];
  const educationDetailLabel = getEducationDetailLabel(value.grade);
  const hasLegacyEducationValue = Boolean(
    value.grade && !PATIENT_EDUCATION_OPTIONS.includes(value.grade as (typeof PATIENT_EDUCATION_OPTIONS)[number]),
  );

  const selectedProfessionalNames = careProfessionals
    .map(item => item.specialty === 'Outro' ? item.customSpecialty || 'Outro' : item.specialty)
    .filter(Boolean)
    .join(', ');

  const updateProfessional = (id: string, patch: Record<string, string>) => {
    onChange({
      careProfessionals: careProfessionals.map(item => item.id === id ? { ...item, ...patch } : item),
    });
  };

  const toggleProfessional = (specialty: string, checked: boolean) => {
    if (checked) {
      if (careProfessionals.some(item => item.specialty === specialty)) return;
      onChange({ careProfessionals: [...careProfessionals, createPatientCareProfessional(specialty)] });
      return;
    }
    onChange({ careProfessionals: careProfessionals.filter(item => item.specialty !== specialty) });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-clinic-border bg-gradient-to-br from-clinic-primary/10 via-white to-clinic-bg p-4 shadow-sm">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-clinic-primary">Cadastro inteligente</p>
          <h3 className="mt-1 truncate text-xl font-black text-clinic-text">{compactValue(value.fullName || value.name, 'Atendente sem nome completo')}</h3>
          <p className="mt-1 text-sm font-semibold text-clinic-text-muted">
            Responsável: {compactValue(value.guardianName)} • WhatsApp: {compactValue(value.whatsapp)}
          </p>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-clinic-text-muted">
            Mantenha atualizados o 1º Nome do Atendente, o 1º Nome do Responsável e o WhatsApp do Responsável. Esses dados são usados nas comunicações da clínica.
          </p>
        </div>
      </section>

      <div className="space-y-4">
        <DetailsPanel
          title="Dados do Atendente"
          icon={<UserRound size={18} />}
          summary={`${compactValue(value.name, '1º nome pendente')} • ${compactValue(value.sex)}`}
          defaultOpen
        >
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            <label>
              <span className={labelClass}>1º Nome do Atendente{requiredCore ? ' *' : ''}</span>
              <input
                type="text"
                value={value.name || ''}
                onChange={event => onChange({ name: event.target.value })}
                disabled={disabled}
                className={inputClass}
                placeholder="Nome usado nas mensagens"
              />
              <span className="mt-1 block text-[10px] text-clinic-text-muted">Usado nas mensagens e lembretes da clínica.</span>
            </label>
            <label>
              <span className={labelClass}>Nome completo do Atendente{requiredCore ? ' *' : ''}</span>
              <input
                type="text"
                value={value.fullName || ''}
                onChange={event => {
                  const fullName = event.target.value;
                  const previousAutoFirstName = getFirstName(value.fullName);
                  const currentFirstName = String(value.name || '').trim();
                  const shouldSuggestFirstName = !currentFirstName || currentFirstName === previousAutoFirstName;
                  onChange({
                    fullName,
                    ...(shouldSuggestFirstName ? { name: getFirstName(fullName) } : {}),
                  });
                }}
                disabled={disabled}
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Data de nascimento{requiredCore ? ' *' : ''}</span>
              <input
                type="date"
                value={value.birthDate || ''}
                onChange={event => onChange({ birthDate: event.target.value })}
                disabled={disabled}
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Sexo</span>
              <select
                value={value.sex || 'Não informado'}
                onChange={event => onChange({ sex: event.target.value as PatientRegistrationData['sex'] })}
                disabled={disabled}
                className={inputClass}
              >
                {PATIENT_SEX_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
        </DetailsPanel>

        <DetailsPanel
          title="Responsáveis e Contatos"
          icon={<Users size={18} />}
          summary={`Principal: ${compactValue(value.guardianName)} • ${compactValue(value.whatsapp)}`}
          defaultOpen
        >
          <div className="grid items-start gap-3 md:grid-cols-2">
            <div className="space-y-3">
              <FieldGroup title="Responsável principal">
              <label>
                <span className={labelClass}>1º Nome do Responsável{requiredCore ? ' *' : ''}</span>
                <input
                  type="text"
                  value={value.guardianName || ''}
                  onChange={event => onChange({ guardianName: event.target.value })}
                  disabled={disabled}
                  className={inputClass}
                  placeholder="Nome usado nas mensagens"
                />
              </label>
              <label>
                <span className={labelClass}>WhatsApp do Responsável{requiredCore ? ' *' : ''}</span>
                <input
                  type="tel"
                  value={value.whatsapp || ''}
                  onChange={event => onChange({ whatsapp: event.target.value })}
                  disabled={disabled}
                  className={inputClass}
                  placeholder="27 99999-0000"
                />
                <span className="mt-1 block text-[10px] text-clinic-text-muted">Número principal usado nas comunicações da clínica. Não vincula automaticamente mãe ou pai.</span>
              </label>
            </FieldGroup>

            <FieldGroup title="Mãe">
              <label>
                <span className={labelClass}>Nome completo da mãe</span>
                <input type="text" value={value.motherName || ''} onChange={event => onChange({ motherName: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Profissão da mãe</span>
                <input type="text" value={value.motherProfession || ''} onChange={event => onChange({ motherProfession: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Contato da mãe</span>
                <input type="tel" value={value.motherPhone || ''} onChange={event => onChange({ motherPhone: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              </FieldGroup>
            </div>

            <div className="space-y-3">
              <FieldGroup title="Pai">
              <label>
                <span className={labelClass}>Nome completo do pai</span>
                <input type="text" value={value.fatherName || ''} onChange={event => onChange({ fatherName: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Profissão do pai</span>
                <input type="text" value={value.fatherProfession || ''} onChange={event => onChange({ fatherProfession: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Contato do pai</span>
                <input type="tel" value={value.fatherPhone || ''} onChange={event => onChange({ fatherPhone: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
            </FieldGroup>

            <FieldGroup title="Outro responsável">
              <label>
                <span className={labelClass}>Nome completo de outro responsável</span>
                <input type="text" value={value.otherResponsibleName || ''} onChange={event => onChange({ otherResponsibleName: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Parentesco</span>
                <input type="text" value={value.otherResponsibleKinship || ''} onChange={event => onChange({ otherResponsibleKinship: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Contato</span>
                <input type="tel" value={value.otherResponsiblePhone || ''} onChange={event => onChange({ otherResponsiblePhone: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              </FieldGroup>
            </div>
          </div>
        </DetailsPanel>

        <div className="grid items-start gap-4 md:grid-cols-2">
          <DetailsPanel
            title="Escolar"
          icon={<GraduationCap size={18} />}
          summary={`${compactValue(value.school, 'Escola pendente')} • ${compactValue(value.grade)}`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={labelClass}>Escola</span>
              <input type="text" value={value.school || ''} onChange={event => onChange({ school: event.target.value })} disabled={disabled} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Ano/nível escolar</span>
              <select value={value.grade || 'Não informado'} onChange={event => onChange({ grade: event.target.value })} disabled={disabled} className={inputClass}>
                {hasLegacyEducationValue && <option value={value.grade}>{value.grade} — valor cadastrado anteriormente</option>}
                {PATIENT_EDUCATION_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              <span className={labelClass}>Turno</span>
              <select value={value.shift || ''} onChange={event => onChange({ shift: event.target.value })} disabled={disabled} className={inputClass}>
                <option value="">Não informado</option>
                {PATIENT_SHIFT_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {educationDetailLabel && (
              <label className="sm:col-span-2">
                <span className={labelClass}>{educationDetailLabel}</span>
                <input type="text" value={value.educationDetail || ''} onChange={event => onChange({ educationDetail: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
            )}
          </div>
        </DetailsPanel>

        <DetailsPanel
          title="Situação Familiar e Guarda"
          icon={<ShieldCheck size={18} />}
          summary={`${compactValue(value.familyStatus)} • ${compactValue(value.custodyStatus)}`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Situação familiar</span>
              <select value={value.familyStatus || ''} onChange={event => onChange({ familyStatus: event.target.value as PatientRegistrationData['familyStatus'] })} disabled={disabled} className={inputClass}>
                <option value="">Não informado</option>
                {PATIENT_FAMILY_STATUS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              <span className={labelClass}>Situação da guarda</span>
              <select value={value.custodyStatus || ''} onChange={event => onChange({ custodyStatus: event.target.value as PatientRegistrationData['custodyStatus'] })} disabled={disabled} className={inputClass}>
                <option value="">Não informado</option>
                {PATIENT_CUSTODY_STATUS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {value.custodyStatus === 'Guarda de outro responsável' && (
              <>
                <label>
                  <span className={labelClass}>Nome do responsável pela guarda</span>
                  <input type="text" value={value.custodyResponsibleName || ''} onChange={event => onChange({ custodyResponsibleName: event.target.value })} disabled={disabled} className={inputClass} />
                </label>
                <label>
                  <span className={labelClass}>Parentesco</span>
                  <input type="text" value={value.custodyResponsibleKinship || ''} onChange={event => onChange({ custodyResponsibleKinship: event.target.value })} disabled={disabled} className={inputClass} />
                </label>
              </>
            )}
          </div>
          </DetailsPanel>
        </div>
      </div>

      <DetailsPanel
        title="Acompanhamentos Profissionais e Saúde"
        icon={<HeartHandshake size={18} />}
        summary={selectedProfessionalNames || 'Nenhum acompanhamento selecionado'}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PATIENT_CARE_SPECIALTY_OPTIONS.map(specialty => {
            const professional = careProfessionals.find(item => item.specialty === specialty);
            return (
              <div key={specialty} className={`rounded-2xl border p-3 transition ${professional ? 'border-clinic-primary/30 bg-clinic-primary/10 shadow-sm' : 'border-clinic-border bg-clinic-bg/60'}`}>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-clinic-text">
                  <input
                    type="checkbox"
                    checked={Boolean(professional)}
                    onChange={event => toggleProfessional(specialty, event.target.checked)}
                    disabled={disabled}
                    className="h-4 w-4 accent-clinic-primary"
                  />
                  {specialty}
                </label>
                {professional && (
                  <div className="mt-3 space-y-2 border-t border-clinic-border/60 pt-3">
                    {specialty === 'Outro' && (
                      <input
                        type="text"
                        value={professional.customSpecialty || ''}
                        onChange={event => updateProfessional(professional.id, { customSpecialty: event.target.value })}
                        disabled={disabled}
                        className={inputClass}
                        placeholder="Informe a especialidade"
                      />
                    )}
                    <input
                      type="text"
                      value={professional.name || ''}
                      onChange={event => updateProfessional(professional.id, { name: event.target.value })}
                      disabled={disabled}
                      className={inputClass}
                      placeholder="Nome do profissional"
                    />
                    <input
                      type="text"
                      value={professional.contact || ''}
                      onChange={event => updateProfessional(professional.id, { contact: event.target.value })}
                      disabled={disabled}
                      className={inputClass}
                      placeholder="Telefone ou contato"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {value.doctorName && (
          <label className="mt-4 block rounded-xl border border-status-orange-text/20 bg-status-orange-bg/40 p-3">
            <span className={labelClass}>Profissional/médico informado anteriormente</span>
            <input type="text" value={value.doctorName || ''} onChange={event => onChange({ doctorName: event.target.value })} disabled={disabled} className={inputClass} />
            <span className="mt-1 block text-[10px] text-clinic-text-muted">Campo legado preservado para não perder informações já cadastradas.</span>
          </label>
        )}
        {showClinicalFields && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <label>
              <span className={labelClass}>Medicação em uso</span>
              <textarea rows={4} value={value.medication || ''} onChange={event => onChange({ medication: event.target.value })} disabled={disabled} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Contato de emergência</span>
              <textarea rows={4} value={value.emergencyContact || ''} onChange={event => onChange({ emergencyContact: event.target.value })} disabled={disabled} className={inputClass} />
            </label>
            <label>
              <span className={labelClass}>Alergias e restrições</span>
              <textarea rows={4} value={value.allergies || ''} onChange={event => onChange({ allergies: event.target.value })} disabled={disabled} className={inputClass} />
            </label>
          </div>
        )}
      </DetailsPanel>

      <DetailsPanel
        title="Responsável Financeiro"
        icon={<BriefcaseBusiness size={18} />}
        summary={compactValue(value.financialResponsible)}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className={labelClass}>Responsável financeiro</span>
            <select value={value.financialResponsible || ''} onChange={event => onChange({ financialResponsible: event.target.value as PatientRegistrationData['financialResponsible'] })} disabled={disabled} className={inputClass}>
              <option value="">Não informado</option>
              {PATIENT_FINANCIAL_RESPONSIBLE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          {value.financialResponsible === 'Outro' && (
            <>
              <label>
                <span className={labelClass}>Nome completo</span>
                <input type="text" value={value.financialResponsibleOtherName || ''} onChange={event => onChange({ financialResponsibleOtherName: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Parentesco</span>
                <input type="text" value={value.financialResponsibleOtherKinship || ''} onChange={event => onChange({ financialResponsibleOtherKinship: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>Telefone</span>
                <input type="tel" value={value.financialResponsibleOtherPhone || ''} onChange={event => onChange({ financialResponsibleOtherPhone: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
              <label>
                <span className={labelClass}>CPF (opcional)</span>
                <input type="text" value={value.financialResponsibleOtherCpf || ''} onChange={event => onChange({ financialResponsibleOtherCpf: event.target.value })} disabled={disabled} className={inputClass} />
              </label>
            </>
          )}
        </div>
        <p className="mt-3 text-[10px] text-clinic-text-muted">Informação apenas cadastral. Não altera pagamentos, recibos, contratos ou cobranças.</p>
      </DetailsPanel>
    </div>
  );
}


interface PatientRegistrationSummaryProps {
  value: Partial<PatientRegistrationData>;
}

function SummarySection({ title, items }: { title: string; items: Array<[string, unknown]> }) {
  return (
    <section className="rounded-2xl border border-clinic-border bg-white/70 p-4 shadow-sm">
      <h4 className="mb-3 border-b border-clinic-border pb-2 text-sm font-black text-clinic-text">{title}</h4>
      <div className="space-y-1">
        {items.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 border-b border-clinic-border/40 py-2 sm:flex-row sm:items-start sm:justify-between">
            <span className="text-[10px] font-black uppercase tracking-wide text-clinic-text-faint">{label}</span>
            <span className="max-w-xl whitespace-pre-wrap text-sm font-semibold text-clinic-text sm:text-right">{formatPatientRegistrationValue(label, value)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PatientRegistrationSummary({ value }: PatientRegistrationSummaryProps) {
  const educationDetailLabel = getEducationDetailLabel(value.grade);
  const careProfessionals = Array.isArray(value.careProfessionals) ? value.careProfessionals : [];
  const careProfessionalText = careProfessionals.map(item => {
    const specialty = item.specialty === 'Outro' ? item.customSpecialty || 'Outro' : item.specialty;
    const detail = [item.name, item.contact].filter(Boolean).join(' — ');
    return detail ? `${specialty}: ${detail}` : specialty;
  }).join('\n');

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-clinic-border bg-gradient-to-br from-clinic-primary/10 via-white to-clinic-bg p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-clinic-primary">Resumo cadastral</p>
            <h3 className="mt-1 text-xl font-black text-clinic-text">{compactValue(value.fullName || value.name, 'Atendente sem nome completo')}</h3>
            <p className="mt-1 text-sm font-semibold text-clinic-text-muted">Responsável: {compactValue(value.guardianName)} • WhatsApp: {compactValue(value.whatsapp)}</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-clinic-border bg-white/80 px-3 py-2 text-xs font-black text-clinic-primary">
            <Phone size={15} /> Contato principal cadastrado
          </div>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SummarySection title="Dados do Atendente" items={[
          ['1º Nome do Atendente', value.name],
          ['Nome completo do Atendente', value.fullName],
          ['Data de nascimento', value.birthDate],
          ['Sexo', value.sex || 'Não informado'],
        ]} />
        <SummarySection title="Responsáveis e Contatos" items={[
          ['1º Nome do Responsável', value.guardianName],
          ['WhatsApp do Responsável', value.whatsapp],
          ['Nome completo da mãe', value.motherName],
          ['Profissão da mãe', value.motherProfession],
          ['Contato da mãe', value.motherPhone],
          ['Nome completo do pai', value.fatherName],
          ['Profissão do pai', value.fatherProfession],
          ['Contato do pai', value.fatherPhone],
          ['Outro responsável', value.otherResponsibleName],
          ['Parentesco do outro responsável', value.otherResponsibleKinship],
          ['Contato de outro responsável', value.otherResponsiblePhone],
        ]} />
        <SummarySection title="Escolar" items={[
          ['Escola', value.school],
          ['Ano/nível escolar', value.grade],
          ...(educationDetailLabel ? [[educationDetailLabel, value.educationDetail] as [string, unknown]] : []),
          ['Turno', value.shift],
        ]} />
        <SummarySection title="Situação Familiar e Guarda" items={[
          ['Situação familiar', value.familyStatus],
          ['Situação da guarda', value.custodyStatus],
          ['Responsável pela guarda', value.custodyResponsibleName],
          ['Parentesco', value.custodyResponsibleKinship],
        ]} />
        <SummarySection title="Acompanhamentos Profissionais" items={[
          ['Profissionais', careProfessionalText],
          ['Informação legada', value.doctorName],
          ['Medicação em uso', value.medication],
          ['Contato de emergência', value.emergencyContact],
          ['Alergias e restrições', value.allergies],
        ]} />
        <SummarySection title="Responsável Financeiro" items={[
          ['Responsável financeiro', value.financialResponsible],
          ['Nome completo', value.financialResponsibleOtherName],
          ['Parentesco', value.financialResponsibleOtherKinship],
          ['Telefone', value.financialResponsibleOtherPhone],
          ['CPF', value.financialResponsibleOtherCpf],
        ]} />
      </div>
    </div>
  );
}
