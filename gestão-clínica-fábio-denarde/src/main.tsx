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
  void import('./App.tsx').then(({ default: App }) => {
    createRoot(root).render(<App />);
  });
}
