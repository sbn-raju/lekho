import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Brand fonts (self-hosted): Manrope for headings, Inter for UI/body.
import '@fontsource-variable/manrope';
import '@fontsource-variable/inter';

// Mantine styles — core first, then the packages used at the app root.
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/charts/styles.css';

import './styles/global.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
