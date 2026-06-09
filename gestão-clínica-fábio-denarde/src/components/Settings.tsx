import React, { useState, useRef } from 'react';
import { AppState, ClinicSettings, Patient, PaymentModal } from '../types';
import { Save, Building, Mail, Phone, MapPin, User, CheckCircle, Database, Download, Upload, Calendar, Trash2, Palette, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Papa from 'papaparse';
import { safeFormatDate, generateHolidaysForYear } from '../lib/utils';
import { APP_THEMES, resolveTheme, type AppTheme } from '../lib/theme';

interface SettingsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
  onThemeChange: (theme: AppTheme) => Promise<boolean>;
}

export default function Settings({ state, onUpdate, onThemeChange }: SettingsProps) {
  const [settings, setSettings] = useState<ClinicSettings>(state.settings);
  const [success, setSuccess] = useState(false);
  const [themeMessage, setThemeMessage] = useState('');
  const [savingTheme, setSavingTheme] = useState<AppTheme | null>(null);
  const [themeOptionsOpen, setThemeOptionsOpen] = useState(false);
  const [importSuccess, setImportSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');

  const handleAddHoliday = () => {
    if (!newHolidayDate || !newHolidayName) return;
    const newHoliday = {
      id: Math.random().toString(36).substring(2, 9),
      date: newHolidayDate,
      name: newHolidayName
    };
    setSettings(prev => ({
      ...prev,
      holidays: [...(prev.holidays || []), newHoliday].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    }));
    setNewHolidayDate('');
    setNewHolidayName('');
  };

  const handleRemoveHoliday = (id: string) => {
    setSettings(prev => ({
      ...prev,
      holidays: (prev.holidays || []).filter(h => h.id !== id)
    }));
  };

  const handleAutoFillHolidays = () => {
    const currentYear = new Date().getFullYear();
    const autoHolidays = generateHolidaysForYear(currentYear).map(h => ({
      id: Math.random().toString(36).substring(2, 9),
      date: h.date,
      name: h.name
    }));

    setSettings(prev => {
      const existing = prev.holidays || [];
      // Prevent duplicates by checking the date
      const newOnly = autoHolidays.filter(ah => !existing.some(eh => eh.date === ah.date));
      return {
        ...prev,
        holidays: [...existing, ...newOnly].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      };
    });
  };

  const handleSave = () => {
    onUpdate({
      settings: {
        ...settings,
        visualTheme: state.settings.visualTheme,
      },
    });
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  const handleThemeChange = async (theme: AppTheme) => {
    if (savingTheme || theme === resolveTheme(state.settings.visualTheme)) return;

    setSavingTheme(theme);
    setThemeMessage('');
    const saved = await onThemeChange(theme);
    setThemeMessage(saved ? 'Tema aplicado e salvo.' : 'Tema aplicado. Não foi possível sincronizar com o banco.');
    setSavingTheme(null);
    setTimeout(() => setThemeMessage(''), 3500);
  };

  const exportCSV = () => {
    const data = state.patients.map(p => ({
      ID: p.id,
      Nome: p.name,
      'Data de Nascimento': p.birthDate,
      Responsável: p.guardianName,
      WhatsApp: p.whatsapp,
      'Dia Fixo': p.fixedDay,
      'Horário Fixo': p.fixedTime,
      'Modalidade Pagamento': p.paymentModal,
      'Data de Início': p.startDate,
      Escola: p.school || '',
      Série: p.grade || '',
      Turno: p.shift || '',
      Médico: p.doctorName || '',
      Medicação: p.medication || '',
      Status: p.status || 'Ativo',
      Anotações: p.clinicalNotes || ''
    }));

    const csv = Papa.unparse(data, { delimiter: ';' });
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'backup_atendentes.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUploadAction = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as any[];
          const newPatients: Patient[] = rows.map(row => {
            const tempPatient = state.patients.find(p => p.id === row.ID);
            return {
              id: row.ID || Date.now().toString() + Math.random().toString(36).substring(2, 9),
              name: row.Nome,
              birthDate: row['Data de Nascimento'],
              guardianName: row.Responsável,
              whatsapp: row.WhatsApp,
              fixedDay: row['Dia Fixo'],
              fixedTime: row['Horário Fixo'],
              paymentModal: (row['Modalidade Pagamento'] as PaymentModal) || PaymentModal.PIX_FULL,
              startDate: row['Data de Início'],
              school: row.Escola,
              grade: row.Série,
              shift: row.Turno,
              doctorName: row.Médico,
              medication: row.Medicação,
              status: row.Status === 'Concluído' ? 'Concluído' : 'Ativo',
              clinicalNotes: row.Anotações || tempPatient?.clinicalNotes || '',
              anamnese: tempPatient?.anamnese || {
                complaint: '',
                school: '',
                grade: '',
                referredBy: '',
                diagnoses: '',
                initialNotes: ''
              }
            };
          });

          const mergedPatients = [...state.patients];
          newPatients.forEach(p => {
            const index = mergedPatients.findIndex(ex => ex.id === p.id);
            if (index >= 0) {
              mergedPatients[index] = { ...mergedPatients[index], ...p };
            } else {
              mergedPatients.push(p);
            }
          });

          onUpdate({ patients: mergedPatients });
          setImportSuccess('Dados importados com sucesso!');
          setTimeout(() => setImportSuccess(''), 4000);
        } catch (err) {
          console.error(err);
          setImportSuccess('Erro ao importar arquivo. Verifique o formato do CSV.');
          setTimeout(() => setImportSuccess(''), 4000);
        }
        if (e.target) e.target.value = '';
      }
    });
  };

  const currentTheme = APP_THEMES.find(theme => theme.id === resolveTheme(state.settings.visualTheme)) ?? APP_THEMES[0];

  return (
    <div className="flex w-full flex-col gap-6 py-6 pb-20">
      <section className="w-full rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic sm:p-6 xl:p-8">
        <h2 className="text-2xl font-bold text-clinic-text mb-6 flex items-center gap-2">
          <Building className="text-clinic-primary" />
          Configurações da Clínica
        </h2>

        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Nome Profissional</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={16} />
                <input 
                  type="text" 
                  value={settings.name}
                  onChange={(e) => setSettings({...settings, name: e.target.value})}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Especialidade / Título</label>
              <input 
                type="text" 
                value={settings.specialty}
                onChange={(e) => setSettings({...settings, specialty: e.target.value})}
                className="w-full px-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
              />
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-1">
              <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Descrição Curta (Header)</label>
              <input
                type="text"
                value={settings.title}
                onChange={(e) => setSettings({...settings, title: e.target.value})}
                className="w-full px-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
                placeholder="Ex: Neuropsicopedagogia"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={16} />
                <input 
                  type="email" 
                  value={settings.email}
                  onChange={(e) => setSettings({...settings, email: e.target.value})}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">WhatsApp</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={16} />
                <input 
                  type="text" 
                  value={settings.whatsapp}
                  onChange={(e) => setSettings({...settings, whatsapp: e.target.value})}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
                />
              </div>
            </div>
            <div className="space-y-1 md:col-span-2 xl:col-span-1">
              <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Endereço Completo</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" size={16} />
                <input
                  type="text"
                  value={settings.address}
                  onChange={(e) => setSettings({...settings, address: e.target.value})}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-clinic-border">
            <h3 className="font-bold text-lg text-clinic-text mb-4">Personalização da Plataforma e Relatórios</h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Cabeçalho Personalizado (opcional)</label>
                <textarea 
                  value={settings.customHeader || ''}
                  onChange={(e) => setSettings({...settings, customHeader: e.target.value})}
                  className="w-full p-4 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm"
                  placeholder="Se preenchido, substituirá o cabeçalho padrão na plataforma e nos relatórios em PDF..."
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Rodapé Personalizado (opcional)</label>
                <textarea 
                  value={settings.customFooter || ''}
                  onChange={(e) => setSettings({...settings, customFooter: e.target.value})}
                  className="w-full p-4 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm"
                  placeholder="Se preenchido, substituirá o rodapé padrão na plataforma e nos relatórios em PDF..."
                  rows={2}
                />
              </div>
            </div>
          </div>

          <section className="border-t border-clinic-border pt-5">
            <div className="flex flex-col gap-4 rounded-xl border border-clinic-border bg-clinic-bg/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Palette size={17} className="shrink-0 text-clinic-primary" />
                  <h3 className="text-base font-bold text-clinic-text">Aparência do Sistema</h3>
                </div>
                <p className="mt-1 text-xs text-clinic-text-muted">
                  Personalize as cores da interface sem alterar dados ou relatórios.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:min-w-[320px] sm:flex-row sm:items-center sm:justify-end">
                <div className="flex items-center gap-3 rounded-lg border border-clinic-border bg-clinic-surface px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="block text-[9px] font-black uppercase tracking-wider text-clinic-text-faint">Tema atual</span>
                    <span className="block truncate text-sm font-bold text-clinic-text">{currentTheme.name}</span>
                  </div>
                  <div className="flex shrink-0 gap-1" role="img" aria-label={`Prévia do tema ${currentTheme.name}`}>
                    {currentTheme.preview.map((color, index) => (
                      <span
                        key={`${color}-${index}`}
                        className="h-5 w-5 rounded-full border border-black/10"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setThemeOptionsOpen(open => !open)}
                  aria-expanded={themeOptionsOpen}
                  aria-controls="theme-options"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-clinic-primary/30 bg-clinic-surface px-4 py-2 text-xs font-black uppercase tracking-wider text-clinic-primary transition-colors hover:bg-clinic-bg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-clinic-primary/30"
                >
                  {themeOptionsOpen ? 'Fechar opções' : 'Alterar tema'}
                  <ChevronDown size={15} className={`transition-transform duration-200 ${themeOptionsOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {themeOptionsOpen && (
                <motion.div
                  id="theme-options"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2 2xl:grid-cols-4">
                    {APP_THEMES.map(theme => {
                      const isSelected = currentTheme.id === theme.id;
                      const isSaving = savingTheme === theme.id;

                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => handleThemeChange(theme.id)}
                          aria-pressed={isSelected}
                          disabled={savingTheme !== null}
                          className={`min-h-[108px] rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-clinic-primary/30 disabled:cursor-wait ${
                            isSelected
                              ? 'border-clinic-primary/60 bg-clinic-bg shadow-sm'
                              : 'border-clinic-border bg-clinic-surface hover:border-clinic-border-dark hover:bg-clinic-bg/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-bold text-clinic-text">{theme.name}</span>
                                {theme.isDefault && (
                                  <span className="rounded-full bg-clinic-nav-bg px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-clinic-header">
                                    Padrão
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] leading-snug text-clinic-text-muted">{theme.description}</p>
                            </div>
                            <span
                              aria-hidden="true"
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                isSelected ? 'border-clinic-primary bg-clinic-primary text-white' : 'border-clinic-border-dark'
                              }`}
                            >
                              {isSelected && <CheckCircle size={13} />}
                            </span>
                          </div>

                          <div className="mt-3 flex gap-1.5" role="img" aria-label={`Paleta ${theme.name}`}>
                            {theme.preview.map((color, index) => (
                              <span
                                key={`${color}-${index}`}
                                className="h-5 w-8 rounded-md border border-black/10"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>

                          {isSaving && (
                            <span className="mt-2 block text-[9px] font-black uppercase tracking-wider text-clinic-text-faint">
                              Salvando...
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-3 min-h-5 text-[10px] font-bold text-clinic-text-faint">
              {themeMessage ? (
                <span role="status" className="text-clinic-text-muted">{themeMessage}</span>
              ) : (
                <span>Esta preferência é aplicada e salva automaticamente.</span>
              )}
            </div>
          </section>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-clinic-primary px-8 py-3 font-bold text-white shadow-lg transition-all hover:bg-clinic-primary-hover active:scale-95 sm:w-auto"
            >
              {success ? (
                <><CheckCircle size={20} /> Alterações Salvas!</>
              ) : (
                <><Save size={20} /> Salvar Configurações</>
              )}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* Feriados e Recessos Section */}
      <section className="w-full rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic sm:p-6 xl:p-8">
        <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-xl font-bold text-clinic-text">
            <Calendar className="text-clinic-primary" />
            Feriados e Recessos
          </h2>
          <button 
            onClick={handleAutoFillHolidays}
            title={`Preencher automaticamente com feriados nacionais e de Vila Velha para ${new Date().getFullYear()}`}
            className="flex items-center justify-center gap-1 self-start rounded-lg bg-clinic-bg px-3 py-2 text-xs font-bold text-clinic-primary shadow-sm transition-colors hover:bg-clinic-border sm:self-auto"
          >
            <Calendar size={14} /> Auto-preencher {new Date().getFullYear()}
          </button>
        </div>
        <p className="text-sm text-clinic-text-muted mb-6">
          Cadastre os dias em que você não fará atendimentos. O robô irá pausar automaticamente o envio de mensagens para os pacientes nessas datas e avisará você com um dia de antecedência.
        </p>
        
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <input 
            type="date" 
            value={newHolidayDate}
            onChange={e => setNewHolidayDate(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
          />
          <input 
            type="text" 
            placeholder="Nome do Feriado / Recesso"
            value={newHolidayName}
            onChange={e => setNewHolidayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddHoliday()}
            className="flex-1 px-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
          />
          <button 
            onClick={handleAddHoliday}
            disabled={!newHolidayDate || !newHolidayName}
            className="bg-clinic-primary hover:bg-clinic-primary-hover disabled:opacity-50 text-white px-6 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-95"
          >
            Adicionar
          </button>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
          {(!settings.holidays || settings.holidays.length === 0) ? (
            <p className="text-center text-clinic-text-faint text-sm italic py-4 bg-clinic-bg rounded-xl border border-clinic-border/50">Nenhum feriado cadastrado.</p>
          ) : (
            settings.holidays.map(holiday => (
              <div key={holiday.id} className="flex justify-between items-center p-3 bg-clinic-bg rounded-xl border border-clinic-border">
                <div>
                  <span className="font-bold text-clinic-text text-sm block">{safeFormatDate(holiday.date, 'dd/MM/yyyy')}</span>
                  <span className="text-xs text-clinic-text-muted">{holiday.name}</span>
                </div>
                <button 
                  onClick={() => handleRemoveHoliday(holiday.id)}
                  className="p-2 text-status-red-text hover:bg-status-red-bg rounded-lg transition-colors"
                  title="Remover Feriado"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
        
        <button 
          onClick={handleSave}
          className="w-full mt-6 bg-clinic-primary hover:bg-clinic-primary-hover text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
        >
          {success ? (
            <><CheckCircle size={20} /> Alterações Salvas!</>
          ) : (
            <><Save size={20} /> Salvar Feriados</>
          )}
        </button>
      </section>

      <section className="w-full rounded-2xl border border-clinic-border bg-clinic-surface p-5 shadow-clinic sm:p-6 xl:p-8">
        <h2 className="text-xl font-bold text-clinic-text mb-2 flex items-center gap-2">
          <Database className="text-clinic-primary" />
          Backup e Importação (Planilha)
        </h2>
        <p className="text-sm text-clinic-text-muted mb-6">
          Exporte seus dados para gerar um backup no formato de planilha (CSV). 
          Você também pode adicionar novos atendentes através da planilha e importar o arquivo abaixo para registrar em lote.
        </p>

        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <button 
            onClick={exportCSV}
            className="flex-1 bg-clinic-primary hover:bg-clinic-primary-hover text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
          >
            <Download size={20} /> Exportar Atendentes (CSV)
          </button>
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 bg-white hover:bg-clinic-bg text-clinic-text py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md border border-clinic-border transition-all active:scale-95"
          >
            <Upload size={20} className="text-clinic-primary" /> Importar Planilha (CSV)
          </button>
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            onChange={handleFileUploadAction} 
            className="hidden" 
          />
        </div>
        
        {importSuccess && (
          <div className="p-3 mt-4 rounded-xl text-center text-sm font-bold border border-status-green-text bg-status-green-bg text-status-green-text">
            {importSuccess}
          </div>
        )}
      </section>
      </div>

      {/* Botão de Migração de Pacotes */}
      <button
        type="button"
        disabled
        title="Desativado para proteger os dados reais durante a fase de testes."
        className="w-full mt-4 bg-status-orange-bg text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md opacity-60 cursor-not-allowed"
      >
        <Database size={20} /> Migração de Pacotes Desativada
      </button>

      <div className="w-full text-center text-clinic-text-faint text-xs opacity-50">
        As alterações acima são aplicadas instantaneamente no topo e rodapé da aplicação.
      </div>
    </div>
  );
}
