/** Ponto de entrada do renderer. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StoreProvider } from './state/store';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

// Erros não tratados aparecem na interface (e vão para o log local, sem áudio).
window.addEventListener('error', (event) => {
  console.error('[prisma] erro global:', event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[prisma] promise rejeitada:', event.reason);
});

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
