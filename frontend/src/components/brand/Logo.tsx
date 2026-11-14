import { Box, type BoxProps } from '@mantine/core';
import { brandCopy, logos, tokens } from '@/brand';
import classes from './Logo.module.css';

export type LogoVariant = 'primary' | 'dark-background' | 'monochrome';

export interface LogoProps extends BoxProps {
  /**
   * - `primary`: white / light backgrounds (default)
   * - `dark-background`: dark / navy backgrounds
   * - `monochrome`: one-colour applications only
   */
  variant?: LogoVariant;
  /** Show the symbol only — use where the Lekho name is already clear from context. */
  symbolOnly?: boolean;
  /** Height of the symbol in px; the wordmark scales with it. */
  size?: number;
}

/**
 * Lekho logo. The symbol is the supplied SVG master; the wordmark is set in
 * Manrope 800 as live text (the master SVG uses a <text> element, which cannot
 * load web fonts when rendered via <img>), with the master's proportions.
 * Never stretch, rotate, add shadows, or recolour outside these variants.
 */
export function Logo({ variant = 'primary', symbolOnly = false, size = 32, ...others }: LogoProps) {
  const symbolSrc = variant === 'monochrome' ? logos.symbolMonochrome : logos.symbol;
  const wordmarkColor = variant === 'dark-background' ? tokens.colors.surface : tokens.colors.text;

  return (
    <Box
      className={classes.root}
      role="img"
      aria-label={brandCopy.name}
      style={{ '--logo-size': `${size}px`, '--logo-wordmark-color': wordmarkColor }}
      {...others}
    >
      <img src={symbolSrc} alt="" className={classes.symbol} draggable={false} />
      {!symbolOnly && (
        <span className={classes.wordmark} aria-hidden>
          {brandCopy.name}
        </span>
      )}
    </Box>
  );
}
