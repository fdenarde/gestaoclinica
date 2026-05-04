import React, { useState, useRef } from 'react';
import { AppState, ClinicSettings, Patient, PaymentModal } from '../types';
import { Save, Building, Mail, Phone, MapPin, User, CheckCircle, Database, Download, Upload, Calendar, Trash2 } from 'lucide-react';
import Papa from 'papaparse';
import { safeFormatDate, generateHolidaysForYear } from '../lib/utils';

interface SettingsProps {
  state: AppState;
  onUpdate: (newState: Partial<AppState>) => void;
}

export default function Settings({ state, onUpdate }: SettingsProps) {
  const [settings, setSettings] = useState<ClinicSettings>(state.settings);
  const [success, setSuccess] = useState(false);
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
    onUpdate({ settings });
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
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

  return (
    <div className="flex flex-col gap-6 py-6 pb-20">
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border p-8 shadow-clinic max-w-2xl mx-auto w-full">
        <h2 className="font-serif text-2xl font-bold text-clinic-text mb-6 flex items-center gap-2">
          <Building className="text-clinic-primary" />
          Configurações da Clínica
        </h2>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase text-clinic-text-faint ml-1">Descrição Curta (Header)</label>
            <input 
              type="text" 
              value={settings.title}
              onChange={(e) => setSettings({...settings, title: e.target.value})}
              className="w-full px-4 py-2.5 rounded-xl border border-clinic-border bg-white focus:ring-2 focus:ring-clinic-primary outline-none transition-all text-sm font-bold"
              placeholder="Ex: Neuropsicopedagogia"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          </div>

          <div className="space-y-1">
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

          <div className="pt-4 border-t border-clinic-border">
            <h3 className="font-serif font-bold text-lg text-clinic-text mb-4">Personalização da Plataforma e Relatórios</h3>
            <div className="space-y-4">
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

          <button 
            onClick={handleSave}
            className="w-full mt-8 bg-clinic-primary hover:bg-clinic-primary-hover text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95"
          >
            {success ? (
              <><CheckCircle size={20} /> Alterações Salvas!</>
            ) : (
              <><Save size={20} /> Salvar Configurações</>
            )}
          </button>
        </div>
      </div>

      {/* Feriados e Recessos Section */}
      <div className="bg-clinic-surface rounded-2xl border border-clinic-border p-8 shadow-clinic max-w-2xl mx-auto w-full">
        <h2 className="font-serif text-2xl font-bold text-clinic-text mb-2 flex items-center gap-2">
          <Calendar className="text-clinic-primary" />
          Feriados e Recessos
          <button 
            onClick={handleAutoFillHolidays}
            title={`Preencher automaticamente com feriados nacionais e de Vila Velha para ${new Date().getFullYear()}`}
            className="ml-auto bg-clinic-bg hover:bg-clinic-border text-clinic-primary text-xs px-3 py-1.5 rounded-lg transition-colors font-bold flex items-center gap-1 shadow-sm"
          >
            <Calendar size={14} /> Auto-preencher {new Date().getFullYear()}
          </button>
        </h2>
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
      </div>

      <div className="bg-clinic-surface rounded-2xl border border-clinic-border p-8 shadow-clinic max-w-2xl mx-auto w-full">
        <h2 className="font-serif text-2xl font-bold text-clinic-text mb-2 flex items-center gap-2">
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
      </div>

      {/* Botão de Migração de Pacotes */}
      <button
        onClick={async () => {
          const { runPackageMigration } = await import('../scripts/migratePackages');
          const result = await runPackageMigration();
          alert(result.message);
        }}
        className="w-full mt-4 bg-status-orange-bg hover:bg-status-orange-hover text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-all"
      >
        <Database size={20} /> Migrar Pacotes (Firestore)
      </button>

      <div className="max-w-2xl mx-auto w-full text-center text-clinic-text-faint text-xs opacity-50">
        As alterações acima são aplicadas instantaneamente no topo e rodapé da aplicação.
      </div>
    </div>
  );
}
