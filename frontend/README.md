# Lekho — Frontend

Web app for **Lekho**, *A Complete School & LMS Platform.*

React 19 · TypeScript · Vite · Mantine 9 · React Router · Tabler Icons

## Getting started

```bash
cp .env.example .env    # optional; the defaults work for local development
npm install
npm run dev             # http://localhost:5173
```

Start the backend too (`cd ../backend && npm run dev`). Vite proxies `/api` to
`http://localhost:5000`, so API calls work without CORS setup. The API status indicator at
the bottom of the sidebar shows whether the backend is reachable.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |

## Brand

All UI follows the Lekho brand kit. **Read [`docs/brand/README.md`](docs/brand/README.md) and
[`docs/brand/brand-guidelines.md`](docs/brand/brand-guidelines.md) before building screens.**
A live reference is available at `/brand`.

Key rules: use theme colours (never hard-coded hex), Manrope for headings and Inter for body
text, sentence case, 10–14px radii, and every status shown as colour + icon + label.

## Project structure

```
docs/brand/            Brand guidelines, brand board, kit README
public/                favicon.svg, lekho-app-icon.svg
src/
  brand/               Brand source of truth: logos/, tokens/, index.ts
  theme/               Mantine theme (theme.ts) and status language (status.ts)
  components/          Shared UI: brand/Logo, StatusBadge, PageHeader
  layouts/             AppLayout (sidebar shell), AuthLayout (sign-in)
  pages/               Route-level screens
  features/            Feature modules (screens, data, hooks per domain)
  config/navigation.ts Sidebar modules and routes
  hooks/               Shared hooks (useApiHealth)
  lib/api.ts           Fetch wrapper for the backend (/api/v1)
  styles/global.css    Global styles and --lekho-* CSS variables
  router.tsx           Route table
```

## Adding a module

1. Build screens under `src/features/<module>/`.
2. Replace that module's placeholder route in `src/router.tsx`.
3. Nav items live in `src/config/navigation.ts`. Unbuilt modules show a placeholder page.

Imports use the `@/` alias for `src/` (configured in `vite.config.ts` and `tsconfig.app.json`).
