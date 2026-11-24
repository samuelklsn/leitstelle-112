import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from './i18n';
import { WINDOW_VIEW, connectToSimHost } from './sim-store';
import './styles/tokens.css';

// Fehler im Renderer landen im zentralen Log des Main-Prozesses (ADR-0012).
window.addEventListener('error', (event) => {
  window.ls112?.log('error', event.message, { source: event.filename, line: event.lineno });
});
window.addEventListener('unhandledrejection', (event) => {
  window.ls112?.log('error', 'Unbehandelte Promise-Ablehnung', { reason: String(event.reason) });
});

connectToSimHost(WINDOW_VIEW);

await initI18n();

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
