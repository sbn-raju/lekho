/**
 * Lekho brand entry point.
 *
 * Everything brand-related (tokens, logo files, approved copy) is imported from
 * here so screens never hard-code hex values or asset paths.
 * Source of truth: docs/brand/brand-guidelines.md
 */
import logoPrimary from './logos/lekho-primary.svg';
import logoDarkBackground from './logos/lekho-dark-background.svg';
import logoMonochrome from './logos/lekho-monochrome.svg';
import symbol from './logos/lekho-symbol.svg';
import symbolMonochrome from './logos/lekho-symbol-monochrome.svg';

export { lekhoTheme as tokens } from './tokens/lekho.theme';
export type { LekhoTheme } from './tokens/lekho.theme';

export const logos = {
  /** Full logo for white/light backgrounds. */
  primary: logoPrimary,
  /** Full logo for dark/navy backgrounds. */
  darkBackground: logoDarkBackground,
  /** One-colour applications only. */
  monochrome: logoMonochrome,
  /** Symbol only: sidebar, avatar, splash — where the name is clear from context. */
  symbol,
  symbolMonochrome,
} as const;

export const brandCopy = {
  name: 'Lekho',
  tagline: 'A Complete School & LMS Platform.',
  supportingMessage:
    'Bring school operations, teaching, and learning together in one connected platform.',
} as const;
