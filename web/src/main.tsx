import './index.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Dashboardify root element is missing');

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
const applyColorScheme = () => document.documentElement.classList.toggle('dark', colorScheme.matches);
applyColorScheme();
colorScheme.addEventListener('change', applyColorScheme);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
