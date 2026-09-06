import {createRoot} from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import PrivacyPolicyPage from './components/Public/PrivacyPolicyPage';
import { AppointmentManagementPage, MapsNavigationPage, PublicBookingPage } from './features/psychology-online-booking';
import './index.css';
import { initializeTheme } from './lib/theme';

initializeTheme();

function BootstrapStatus({ state }: { state: 'loading' | 'error' }) {
  const isError = state === 'error';
  return (
    <main
      data-bootstrap-state={state}
      className="flex min-h-screen items-center justify-center bg-clinic-bg p-6"
      aria-live="polite"
    >
      <section className="w-full max-w-md rounded-2xl border border-clinic-border bg-clinic-surface p-7 text-center shadow-clinic">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-clinic-primary">
          {isError ? 'Acesso seguro' : 'Inicialização segura'}
        </p>
        <h1 className="mt-3 text-2xl font-black text-clinic-text">
          {isError ? 'Não foi possível concluir a inicialização.' : 'Carregando acesso…'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-clinic-text-muted">
          {isError ? 'Tente novamente para abrir a área protegida.' : 'Preparando o ambiente seguro da clínica.'}
        </p>
        {isError && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 w-full rounded-xl bg-clinic-primary px-4 py-3 font-bold text-white hover:bg-clinic-primary-hover"
          >
            Tentar novamente
          </button>
        )}
      </section>
    </main>
  );
}

const root = document.getElementById('root')!;
const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
const publicBookingMatch = /^\/agendar\/([^/]+)$/.exec(normalizedPath);
const appointmentManagementMatch = /^\/consulta\/([^/]+)$/.exec(normalizedPath);
const mapsNavigationMatch = /^\/maps\/([^/]+)$/.exec(normalizedPath);

if (publicBookingMatch) {
  createRoot(root).render(<PublicBookingPage professionalSlug={decodeURIComponent(publicBookingMatch[1])} />);
} else if (appointmentManagementMatch) {
  createRoot(root).render(<AppointmentManagementPage managementToken={decodeURIComponent(appointmentManagementMatch[1])} />);
} else if (mapsNavigationMatch) {
  createRoot(root).render(<MapsNavigationPage navigationRef={decodeURIComponent(mapsNavigationMatch[1])} />);
} else if (normalizedPath === '/politica-de-privacidade') {
  createRoot(root).render(<PrivacyPolicyPage />);
} else {
  // O App autenticado só é carregado fora das páginas públicas. Assim, a
  // política não inicializa sessão, listeners ou leituras do Firebase.
  const appRoot = createRoot(root);
  appRoot.render(<BootstrapStatus state="loading" />);
  void import('./App.tsx')
    .then(({ default: App }) => {
      appRoot.render(<App />);
    })
    .catch(() => {
      appRoot.render(<BootstrapStatus state="error" />);
    });
}
