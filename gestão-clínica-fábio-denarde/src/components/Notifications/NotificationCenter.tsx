import React, { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ProfessionalNotificationAction,
  ProfessionalNotificationBulkScope,
  ProfessionalPortalNotification,
} from '../../types/access';

type NotificationCenterTab = 'pending' | 'unread' | 'history';

interface NotificationCenterProps {
  open: boolean;
  notifications: ProfessionalPortalNotification[];
  loading: boolean;
  hasMore: boolean;
  onClose: () => void;
  onOpenNotification: (notification: ProfessionalPortalNotification) => void;
  onRefresh: () => Promise<void> | void;
  onLoadMore: () => Promise<void> | void;
  onManage: (notificationIds: string[], operation: ProfessionalNotificationAction) => Promise<void>;
  onBulkManage: (scope: ProfessionalNotificationBulkScope, operation: ProfessionalNotificationAction) => Promise<void>;
}

const categoryLabels: Record<string, string> = {
  login: 'Login do responsável',
  gallery: 'Consulta à galeria',
  profile_update: 'Atualização cadastral',
  document: 'Documento enviado',
  system: 'Sistema',
  access: 'Acesso',
};

const priorityLabels: Record<string, string> = {
  urgent: 'Urgente',
  important: 'Importante',
  informational: 'Informativa',
};

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function tabMatches(notification: ProfessionalPortalNotification, tab: NotificationCenterTab): boolean {
  if (tab === 'pending') return notification.pendingAction && !notification.completed && !notification.archived;
  if (tab === 'unread') return !notification.read && !notification.archived;
  return notification.completed || notification.archived || notification.ignored || (notification.read && !notification.pendingAction);
}

function priorityClasses(priority: string): string {
  if (priority === 'urgent') return 'bg-status-red-bg text-status-red-text';
  if (priority === 'important') return 'bg-status-orange-bg text-status-orange-text';
  return 'bg-status-blue-bg text-status-blue-text';
}

export default function NotificationCenter({
  open,
  notifications,
  loading,
  hasMore,
  onClose,
  onOpenNotification,
  onRefresh,
  onLoadMore,
  onManage,
  onBulkManage,
}: NotificationCenterProps) {
  const [activeTab, setActiveTab] = useState<NotificationCenterTab>('pending');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const counts = useMemo(() => ({
    pending: notifications.filter(item => tabMatches(item, 'pending')).length,
    unread: notifications.filter(item => tabMatches(item, 'unread')).length,
    history: notifications.filter(item => tabMatches(item, 'history')).length,
  }), [notifications]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
    return notifications.filter(notification => {
      if (!tabMatches(notification, activeTab)) return false;
      if (categoryFilter !== 'all' && notification.category !== categoryFilter) return false;
      if (priorityFilter !== 'all' && notification.priority !== priorityFilter) return false;
      if (periodFilter !== 'all') {
        const timestamp = new Date(notification.updatedAt || notification.createdAt || '').getTime();
        if (!Number.isFinite(timestamp)) return false;
        const now = Date.now();
        const maxAge = periodFilter === 'today'
          ? 24 * 60 * 60 * 1000
          : periodFilter === '7d'
            ? 7 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000;
        if (now - timestamp > maxAge) return false;
      }
      if (!normalizedSearch) return true;
      return [
        notification.title,
        notification.message,
        notification.patientName,
        notification.responsibleName,
        notification.responsibleEmail,
      ].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(normalizedSearch));
    });
  }, [activeTab, categoryFilter, notifications, periodFilter, priorityFilter, search]);

  if (!open) return null;

  const selectedNotifications = notifications.filter(item => selectedIds.has(item.id));
  const allVisibleSelected = filtered.length > 0 && filtered.every(item => selectedIds.has(item.id));

  const changeTab = (tab: NotificationCenterTab) => {
    setActiveTab(tab);
    setSelectedIds(new Set());
  };

  const toggleOne = (id: string) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVisible = () => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (allVisibleSelected) filtered.forEach(item => next.delete(item.id));
      else filtered.forEach(item => next.add(item.id));
      return next;
    });
  };

  const runSelectedAction = async (operation: ProfessionalNotificationAction) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (operation === 'delete' && !window.confirm(`Excluir definitivamente ${ids.length} notificação(ões)? Esta ação não poderá ser desfeita.`)) return;
    setActionLoading(true);
    try {
      await onManage(ids, operation);
      setSelectedIds(new Set());
    } finally {
      setActionLoading(false);
    }
  };

  const runBulkAction = async (scope: ProfessionalNotificationBulkScope, operation: ProfessionalNotificationAction, message: string) => {
    if (!window.confirm(message)) return;
    setActionLoading(true);
    try {
      await onBulkManage(scope, operation);
      setCleanupOpen(false);
      setSelectedIds(new Set());
    } finally {
      setActionLoading(false);
    }
  };

  const canCompleteSelection = selectedNotifications.some(item => item.pendingAction && !item.completed);
  const canArchiveSelection = selectedNotifications.some(item => !item.pendingAction || item.completed);
  const canDeleteSelection = selectedNotifications.length > 0
    && selectedNotifications.every(item => item.archived && !item.protectedFromDeletion);

  return (
    <div className="fixed inset-0 z-[115] flex bg-black/55 p-0 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label="Central de notificações">
      <section className="m-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-clinic-surface shadow-2xl sm:h-[94vh] sm:rounded-3xl sm:border sm:border-clinic-border">
        <header className="flex flex-col gap-3 border-b border-clinic-border bg-clinic-bg px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-clinic-primary">Central de notificações</p>
            <h2 className="mt-1 text-xl font-black text-clinic-text sm:text-2xl">Ações dos responsáveis</h2>
            <p className="mt-1 text-xs text-clinic-text-muted">Pendências, avisos não lidos e histórico em um único local.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onRefresh()} disabled={loading || actionLoading} className="flex items-center gap-2 rounded-xl border border-clinic-border bg-white px-3 py-2 text-xs font-black text-clinic-primary disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-clinic-border bg-white p-2 text-clinic-text-muted" aria-label="Fechar central de notificações"><X size={18} /></button>
          </div>
        </header>

        <div className="border-b border-clinic-border bg-white px-4 pt-3 sm:px-6">
          <div className="flex gap-2 overflow-x-auto pb-3">
            {([
              ['pending', 'Pendentes', counts.pending],
              ['unread', 'Não lidas', counts.unread],
              ['history', 'Histórico', counts.history],
            ] as const).map(([id, label, count]) => (
              <button key={id} type="button" onClick={() => changeTab(id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-black transition ${activeTab === id ? 'bg-clinic-primary text-white' : 'bg-clinic-bg text-clinic-text-muted'}`}>
                {label}<span className={`rounded-full px-2 py-0.5 text-[10px] ${activeTab === id ? 'bg-white/20 text-white' : 'bg-white text-clinic-primary'}`}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-clinic-border bg-clinic-bg/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between sm:px-6">
          <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <label className="relative block">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-clinic-text-faint" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar responsável ou atendente" className="w-full rounded-xl border border-clinic-border bg-white py-2.5 pl-9 pr-3 text-xs outline-none focus:border-clinic-primary" />
            </label>
            <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} className="rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-xs font-bold text-clinic-text">
              <option value="all">Todas as categorias</option>
              {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} className="rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-xs font-bold text-clinic-text">
              <option value="all">Todas as prioridades</option>
              {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={periodFilter} onChange={event => setPeriodFilter(event.target.value)} className="rounded-xl border border-clinic-border bg-white px-3 py-2.5 text-xs font-bold text-clinic-text">
              <option value="all">Todo o período</option>
              <option value="today">Últimas 24 horas</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>

          <div className="relative flex flex-wrap items-center gap-2">
            <button type="button" onClick={toggleVisible} className="rounded-xl border border-clinic-border bg-white px-3 py-2 text-[11px] font-black text-clinic-text-muted">
              {allVisibleSelected ? 'Desmarcar página' : 'Selecionar página'}
            </button>
            <button type="button" onClick={() => setCleanupOpen(current => !current)} className="flex items-center gap-1 rounded-xl border border-clinic-border bg-white px-3 py-2 text-[11px] font-black text-clinic-text-muted">
              Limpar <ChevronDown size={14} />
            </button>
            {cleanupOpen && (
              <div className="absolute right-0 top-11 z-20 w-72 overflow-hidden rounded-2xl border border-clinic-border bg-white shadow-xl">
                <button type="button" onClick={() => void runBulkAction('read_informational', 'archive', 'Limpar as notificações informativas já lidas? Elas serão arquivadas.') } className="block w-full px-4 py-3 text-left text-xs font-bold hover:bg-clinic-bg">Limpar lidas informativas</button>
                <button type="button" onClick={() => void runBulkAction('all_read', 'archive', 'Arquivar todas as notificações lidas que não possuem pendência?') } className="block w-full border-t border-clinic-border px-4 py-3 text-left text-xs font-bold hover:bg-clinic-bg">Arquivar todas as lidas</button>
                <button type="button" onClick={() => void runBulkAction('archived_deletable', 'delete', 'Excluir definitivamente todas as notificações arquivadas que podem ser removidas? Atualizações cadastrais e documentos serão preservados.') } className="block w-full border-t border-clinic-border px-4 py-3 text-left text-xs font-bold text-status-red-text hover:bg-status-red-bg">Excluir todas as arquivadas</button>
              </div>
            )}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-clinic-border bg-status-blue-bg/45 px-4 py-3 sm:px-6">
            <span className="mr-2 text-xs font-black text-clinic-primary">{selectedIds.size} selecionada(s)</span>
            <button type="button" onClick={() => void runSelectedAction('mark_read')} disabled={actionLoading} className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[10px] font-black text-clinic-primary"><Check size={14} /> Marcar lidas</button>
            {canCompleteSelection && <button type="button" onClick={() => void runSelectedAction('complete')} disabled={actionLoading} className="flex items-center gap-1 rounded-lg bg-status-green-bg px-3 py-2 text-[10px] font-black text-status-green-text"><CheckCheck size={14} /> Concluir</button>}
            {canArchiveSelection && <button type="button" onClick={() => void runSelectedAction('archive')} disabled={actionLoading} className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[10px] font-black text-clinic-text-muted"><Archive size={14} /> Arquivar</button>}
            {canArchiveSelection && <button type="button" onClick={() => void runSelectedAction('ignore')} disabled={actionLoading} className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-[10px] font-black text-clinic-text-muted"><Inbox size={14} /> Ignorar</button>}
            {canDeleteSelection && <button type="button" onClick={() => void runSelectedAction('delete')} disabled={actionLoading} className="flex items-center gap-1 rounded-lg bg-status-red-bg px-3 py-2 text-[10px] font-black text-status-red-text"><Trash2 size={14} /> Excluir</button>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading && notifications.length === 0 && (
            <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-clinic-primary" /></div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-clinic-border bg-clinic-bg/50 p-6 text-center">
              <Inbox size={34} className="text-clinic-text-faint" />
              <p className="mt-3 text-sm font-black text-clinic-text">Nenhuma notificação nesta área</p>
              <p className="mt-1 text-xs text-clinic-text-muted">Altere os filtros ou consulte outra aba.</p>
            </div>
          )}
          <div className="space-y-3">
            {filtered.map(notification => (
              <article key={notification.id} className={`rounded-2xl border p-4 shadow-sm transition ${notification.read ? 'border-clinic-border bg-white' : 'border-clinic-primary/35 bg-status-blue-bg/25'}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selectedIds.has(notification.id)} onChange={() => toggleOne(notification.id)} className="mt-1 h-4 w-4 accent-clinic-primary" aria-label={`Selecionar ${notification.title}`} />
                  <button type="button" onClick={() => onOpenNotification(notification)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${priorityClasses(notification.priority)}`}>{priorityLabels[notification.priority] || notification.priority}</span>
                      <span className="rounded-full bg-clinic-bg px-2 py-1 text-[9px] font-black uppercase text-clinic-text-muted">{categoryLabels[notification.category] || notification.category}</span>
                      {notification.pendingAction && !notification.completed && !notification.archived && <span className="rounded-full bg-status-orange-bg px-2 py-1 text-[9px] font-black uppercase text-status-orange-text">Pendente de ação</span>}
                      {notification.completed && <span className="rounded-full bg-status-green-bg px-2 py-1 text-[9px] font-black uppercase text-status-green-text">Concluída</span>}
                      {notification.archived && <span className="rounded-full bg-clinic-bg px-2 py-1 text-[9px] font-black uppercase text-clinic-text-faint">Arquivada</span>}
                    </div>
                    <h3 className="mt-2 break-words text-sm font-black text-clinic-text">{notification.title}</h3>
                    <p className="mt-1 break-words text-xs text-clinic-text-muted">{notification.message}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-clinic-text-faint">
                      <span>{notification.responsibleName || 'Responsável'}</span>
                      <span>{notification.patientName || 'Atendente'}</span>
                      <span className="flex items-center gap-1"><Clock3 size={12} /> {formatDate(notification.updatedAt || notification.createdAt)}</span>
                    </div>
                  </button>
                  {!notification.read && (
                    <button type="button" onClick={() => void onManage([notification.id], 'mark_read')} className="shrink-0 rounded-lg border border-clinic-border bg-white px-2 py-2 text-[9px] font-black uppercase text-clinic-primary" title="Marcar como lida sem abrir">Não abrir</button>
                  )}
                </div>
              </article>
            ))}
          </div>

          {hasMore && (
            <div className="mt-5 flex justify-center">
              <button type="button" onClick={() => void onLoadMore()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-clinic-border bg-white px-5 py-3 text-xs font-black text-clinic-primary disabled:opacity-50">
                {loading ? <Loader2 size={16} className="animate-spin" /> : null} Carregar mais
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
