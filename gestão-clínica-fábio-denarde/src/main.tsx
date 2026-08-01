import {createRoot} from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import App from './App.tsx';
import './index.css';
import { initializeTheme } from './lib/theme';

initializeTheme();

// O ambiente local usa o Firebase real. Evitar StrictMode aqui impede a
// montagem dupla de listeners em desenvolvimento e reduz leituras duplicadas.
createRoot(document.getElementById('root')!).render(<App />);
