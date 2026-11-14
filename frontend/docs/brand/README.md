# Lekho Brand Kit

The brand kit is the source of truth for every Lekho screen and asset. Read
[`brand-guidelines.md`](./brand-guidelines.md) before building new screens or marketing assets.
[`lekho-brand-board.png`](./lekho-brand-board.png) is the visual reference.

## Where everything lives

| Asset | Location | Notes |
|---|---|---|
| Brand guidelines | `docs/brand/brand-guidelines.md` | Colours, type, logo rules, status language, voice |
| Brand board | `docs/brand/lekho-brand-board.png` | Visual reference |
| Logo masters (SVG) | `src/brand/logos/` | `lekho-primary`, `lekho-dark-background`, `lekho-monochrome`, `lekho-symbol`, `lekho-symbol-monochrome` |
| Favicon | `public/favicon.svg` | Linked from `index.html` |
| App icon master | `public/lekho-app-icon.svg` | Also used as `apple-touch-icon` |
| CSS tokens | `src/brand/tokens/lekho.tokens.css` | `--lekho-*` variables, loaded globally |
| TS tokens | `src/brand/tokens/lekho.theme.ts` | Shared with the React Native app |
| Brand entry point | `src/brand/index.ts` | `tokens`, `logos`, `brandCopy` |
| Mantine theme | `src/theme/theme.ts` | Built from `lekho.theme.ts` |
| Status language | `src/theme/status.ts` | Status → colour + icon + label |

A live preview of the kit, built with the real components, is at **`/brand`** in the running app.

## Using the brand in code

```tsx
import { Logo } from '@/components/brand/Logo';
import { StatusBadge } from '@/components/StatusBadge';
import { brandCopy, tokens } from '@/brand';

<Logo />                              // light backgrounds
<Logo variant="dark-background" />    // dark / navy backgrounds
<Logo symbolOnly size={40} />         // when the name is clear from context
<StatusBadge status="overdue" />      // colour + icon + label, always
<Button>Save</Button>                 // primary = brand blue (theme default)
```

- Use Mantine colour names, not hex values: `lekho` (primary), `success`, `warning`, `error`,
  `info`, `draft`, `neutral`. Each palette has the official brand hex at shade 6.
- In hand-written CSS, use the `--lekho-*` variables.
- Fonts (Manrope for headings, Inter for body) are self-hosted via `@fontsource-variable/*`.

## Maintenance

- If a brand token changes, update `src/brand/tokens/lekho.theme.ts` **and**
  `lekho.tokens.css` together. The Mantine theme picks up the TS change automatically, and the
  React Native app should consume the same file.
- The SVGs are editable starting assets. Before a trademark filing or large print run, have the
  final geometry reviewed by a brand designer and export the platform-specific raster sizes
  (PNG favicons, iOS/Android launcher icons).
- Changes made when the kit was imported: duplicate nested `<title>`/`<defs>` elements were
  removed from the SVGs (the geometry is unchanged), and `lekho-symbol-monochrome.svg` was cut
  from the monochrome logo.
