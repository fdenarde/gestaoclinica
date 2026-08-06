import { useRef, useState } from 'react';
import { CheckCircle2, Link2, LogOut, RotateCcw, ShieldCheck, WifiOff } from 'lucide-react';
import Modal from '../../../components/Common/Modal';

interface SimulationHeaderProps {
  connected: boolean;
  onReset: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function SimulationHeader({ connected, onReset, onConnect, onDisconnect }: SimulationHeaderProps) {
  const [dialog, setDialog] = useState<'reset' | 'connect' | 'disconnect' | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const closeDialog = () => setDialog(null);
  const confirmDialog = () => {
    if (dialog === 'reset') onReset();
    if (dialog === 'connect') onConnect();
    if (dialog === 'disconnect') onDisconnect();
    setDialog(null);
  };

  const dialogCopy = dialog === 'reset'
    ? { title: 'Reiniciar demonstração?', description: 'As alterações realizadas nesta demonstração serão desfeitas e os dados iniciais serão restaurados.', action: 'Reiniciar demonstração' }
    : dialog === 'connect'
      ? { title: 'Conectar meu WhatsApp?', description: 'A conexão será simulada localmente. Nenhum aplicativo, site externo ou mensagem será aberto.', action: 'Continuar simulação' }
      : { title: 'Desconectar da simulação?', description: 'O estado conectado será removido somente desta demonstração local.', action: 'Desconectar' };

  return (
    <section className="clinic-card overflow-hidden shadow-clinic" data-testid="simple-simulation-connection">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-clinic-primary/10 text-clinic-primary" aria-hidden="true">
            <ShieldCheck size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-black tracking-tight text-clinic-text sm:text-xl">Conexão do WhatsApp</h2>
            <p className="mt-1 text-sm text-clinic-text-muted">Acompanhe e controle a conexão usada na demonstração.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <p className={connected ? 'inline-flex items-center gap-2 rounded-full border border-status-green-text/20 bg-status-green-bg px-3 py-1.5 text-xs font-black text-status-green-text' : 'inline-flex items-center gap-2 rounded-full border border-clinic-border bg-clinic-bg px-3 py-1.5 text-xs font-bold text-clinic-text-muted'} role="status">
            {connected ? <CheckCircle2 size={15} aria-hidden="true" /> : <WifiOff size={15} className="text-clinic-text-faint" aria-hidden="true" />}
            {connected ? 'Conectado' : 'Não conectado'}
          </p>
          {!connected && <button type="button" onClick={() => setDialog('connect')} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-clinic-primary px-3.5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-clinic-primary-hover focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2"><Link2 size={16} aria-hidden="true" /> Conectar meu WhatsApp</button>}
          {connected && <><button type="button" onClick={onConnect} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-clinic-primary/30 bg-clinic-primary/5 px-3.5 py-2.5 text-xs font-black text-clinic-primary transition hover:bg-clinic-primary/10 focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2"><RotateCcw size={16} aria-hidden="true" /> Reconectar</button><button type="button" onClick={() => setDialog('disconnect')} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-clinic-border bg-clinic-surface px-3.5 py-2.5 text-xs font-bold text-clinic-text-muted transition hover:bg-clinic-bg focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2"><LogOut size={16} aria-hidden="true" /> Desconectar</button></>}
        </div>
      </div>
      <div className="border-t border-clinic-border bg-clinic-bg/45 px-4 py-2.5 sm:px-5">
        <button ref={resetButtonRef} type="button" onClick={() => setDialog('reset')} className="inline-flex items-center gap-2 text-xs font-bold text-clinic-text-faint transition hover:text-clinic-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-clinic-primary/40"><RotateCcw size={14} aria-hidden="true" /> Reiniciar demonstração</button>
      </div>
      {dialog && (
        <Modal isOpen onClose={closeDialog} title={dialogCopy.title} descriptionId="simulation-dialog-description" initialFocusRef={cancelRef}>
          <p id="simulation-dialog-description" className="text-sm leading-6 text-clinic-text-muted">{dialogCopy.description}</p>
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-clinic-border pt-4 sm:flex-row sm:justify-end">
            <button ref={cancelRef} type="button" onClick={closeDialog} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-clinic-border bg-clinic-surface px-4 py-3 text-sm font-bold text-clinic-text-muted transition hover:bg-clinic-bg focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2">Cancelar</button>
            <button type="button" onClick={confirmDialog} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-clinic-primary px-4 py-3 text-sm font-black text-white transition hover:bg-clinic-primary-hover focus:outline-none focus:ring-2 focus:ring-clinic-primary/40 focus:ring-offset-2">{dialogCopy.action}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
