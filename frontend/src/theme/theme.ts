import {
  Badge,
  Button,
  Card,
  createTheme,
  defaultVariantColorsResolver,
  NavLink,
  Paper,
  Table,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from '@mantine/core';
import { tokens } from '@/brand';

const { colors: c, radius, spacing, typography } = tokens;

/*
 * Mantine needs 10-shade palettes. Each palette keeps the official brand hex
 * at index 6 (Mantine's default "filled" shade) so `color="lekho"`,
 * `color="success"` etc. render the exact guideline colours.
 */
const lekho: MantineColorsTuple = [
  '#EFF6FF',
  c.primaryTint, // 1 — selected surfaces, subtle highlights
  '#BFDBFE',
  '#93C5FD',
  '#60A5FA',
  c.primaryLight, // 5 — hover / secondary emphasis
  c.primary, // 6 — main actions, links, active nav
  c.primaryDark, // 7 — pressed states
  '#1E40AF',
  '#1E3A8A',
];

const success: MantineColorsTuple = [
  '#ECFDF5', '#D1FAE5', '#A7F3D0', '#6EE7B7', '#34D399',
  '#22C68D', c.success, '#059669', '#047857', '#065F46',
];

const warning: MantineColorsTuple = [
  '#FFFBEB', '#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24',
  '#F9AE18', c.warning, '#D97706', '#B45309', '#92400E',
];

const error: MantineColorsTuple = [
  '#FEF2F2', '#FEE2E2', '#FECACA', '#FCA5A5', '#F87171',
  '#F45B5B', c.error, '#DC2626', '#B91C1C', '#991B1B',
];

const info: MantineColorsTuple = [
  '#F0F9FF', '#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8',
  '#23B1F1', c.info, '#0284C7', '#0369A1', '#075985',
];

const draft: MantineColorsTuple = [
  '#F5F3FF', '#EDE9FE', '#DDD6FE', '#C4B5FD', '#A78BFA',
  '#9974F8', c.draft, '#7C3AED', '#6D28D9', '#5B21B6',
];

/** Slate neutrals — replaces Mantine's gray so borders/text match the brand. */
const neutral: MantineColorsTuple = [
  c.background, // 0 — app canvas
  '#F1F5F9',
  c.border, // 2 — dividers and outlines
  '#CBD5E1',
  '#94A3B8',
  '#7C8BA1',
  c.neutral, // 6 — inactive / archived, muted text
  '#475569',
  '#334155',
  '#1E293B',
];

/**
 * Guideline: hover uses "Primary light", pressed uses "Primary dark".
 * Mantine's default hover is one shade darker, so override it for the
 * brand palette's filled variant.
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const defaults = defaultVariantColorsResolver(input);
  const color = input.color ?? input.theme.primaryColor;
  if (input.variant === 'filled' && color === 'lekho') {
    return { ...defaults, hover: c.primaryLight };
  }
  return defaults;
};

const px = (n: number) => `${n}px`;

export const theme = createTheme({
  primaryColor: 'lekho',
  primaryShade: 6,
  colors: { lekho, success, warning, error, info, draft, neutral, gray: neutral },
  white: c.surface,
  black: c.text,
  variantColorResolver,

  fontFamily: `'${typography.body} Variable', ${typography.body}, 'Helvetica Neue', Arial, sans-serif`,
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  // Guideline: body 14–16px, helper text 12–13px.
  fontSizes: { xs: px(12), sm: px(13), md: px(14), lg: px(16), xl: px(18) },
  headings: {
    fontFamily: `'${typography.heading} Variable', ${typography.heading}, '${typography.body} Variable', sans-serif`,
    fontWeight: '700',
    // Guideline: page title 24–32px.
    sizes: {
      h1: { fontSize: px(32), lineHeight: '1.2', fontWeight: '800' },
      h2: { fontSize: px(24), lineHeight: '1.25' },
      h3: { fontSize: px(20), lineHeight: '1.3' },
      h4: { fontSize: px(18), lineHeight: '1.35', fontWeight: '600' },
      h5: { fontSize: px(16), lineHeight: '1.4', fontWeight: '600' },
      h6: { fontSize: px(14), lineHeight: '1.4', fontWeight: '600' },
    },
  },

  // Guideline: 10–14px radii for controls and cards, 20px only for feature panels.
  radius: { xs: px(4), sm: px(radius.sm), md: px(radius.md), lg: px(radius.lg), xl: px(radius.xl) },
  defaultRadius: 'md',

  // Brand spacing scale mapped onto Mantine keys (xs → brand sm … xl → brand 2xl).
  spacing: {
    xs: px(spacing.sm),
    sm: px(spacing.md),
    md: px(spacing.lg),
    lg: px(spacing.xl),
    xl: px(spacing['2xl']),
  },

  shadows: {
    xs: '0 1px 2px rgb(15 23 42 / 6%)',
    sm: '0 1px 3px rgb(15 23 42 / 8%), 0 8px 24px rgb(15 23 42 / 4%)', // --lekho-shadow-card
    md: '0 4px 12px rgb(15 23 42 / 8%), 0 12px 32px rgb(15 23 42 / 6%)',
    lg: '0 8px 24px rgb(15 23 42 / 10%), 0 20px 48px rgb(15 23 42 / 8%)',
    xl: '0 12px 32px rgb(15 23 42 / 12%), 0 28px 64px rgb(15 23 42 / 10%)',
  },

  cursorType: 'pointer',
  focusRing: 'auto',

  other: { tokens },

  components: {
    Button: Button.extend({
      defaultProps: { radius: 'md' },
      styles: { root: { fontWeight: 600 } },
    }),
    Card: Card.extend({
      defaultProps: { withBorder: true, radius: 'lg', padding: 'lg', shadow: 'xs' },
    }),
    Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
    // Guideline: sentence case, no all-caps labels.
    Badge: Badge.extend({
      defaultProps: { variant: 'light', radius: 'xl', size: 'lg' },
      styles: { root: { textTransform: 'none', fontWeight: 600 } },
    }),
    NavLink: NavLink.extend({
      defaultProps: { variant: 'light' },
      styles: { root: { borderRadius: px(radius.md) }, label: { fontWeight: 500 } },
    }),
    Table: Table.extend({
      defaultProps: { verticalSpacing: 'sm', horizontalSpacing: 'md', highlightOnHover: true },
    }),
  },
});

/** Page canvas, text, border colours from the brand tokens. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-body': c.background,
    '--mantine-color-text': c.text,
    '--mantine-color-dimmed': c.textMuted,
    '--mantine-color-default-border': c.border,
    '--mantine-color-anchor': c.primary,
  },
  dark: {},
});
