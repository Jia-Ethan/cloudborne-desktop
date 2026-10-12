import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import './index.css';

declare global {
  interface Window {
    __CB_GLASS__?: 'vibrancy' | 'mica' | 'none';
  }
}

// Which native backdrop the window got (see src-tauri/src/window.rs).
document.documentElement.dataset.glass = window.__CB_GLASS__ ?? 'none';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
