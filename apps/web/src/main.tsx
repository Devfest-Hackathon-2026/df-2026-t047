import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './shared/tokens.css';
import { App } from './App.tsx';
import { unlockSfxOnFirstGesture } from './shared/sfx.ts';

unlockSfxOnFirstGesture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
