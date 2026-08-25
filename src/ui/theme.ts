import { Theme, AvafliBranding } from '../types';

/**
 * Default Avafli theme — matches iOS AvafliBranding defaults
 */
export const defaultTheme: Theme = {
  colors: {
    primary: '#FFFFFF',           // primaryColor — white text
    secondary: '#E0E0E0',        // secondaryTextColor
    background: '#0D0D0D',       // backgroundColor — near-black
    surface: '#1A1A2E',          // cardBackgroundColor — dark card
    text: '#FFFFFF',             // primaryColor (text)
    textSecondary: '#A0A0B0',    // mutedTextColor
    success: '#10b981',          // emerald green
    error: '#ef4444',            // red
    warning: '#f59e0b',          // amber
    accent: '#5B4CFF',           // brand accent (CTA/active tile) — overridden by branding.primaryColor
    accentGlow: '#FFD700',       // radial glow — overridden by branding.secondaryColor
  },
  fonts: {
    family: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    sizes: {
      sm: '0.8125rem',   // 13px
      base: '0.9375rem', // 15px
      lg: '1.0625rem',   // 17px
      xl: '1.375rem',    // 22px
      '2xl': '1.625rem', // 26px
      '3xl': '1.875rem', // 30px
    },
    weights: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
  },
  borderRadius: {
    sm: '0.5rem',   // 8px
    md: '0.75rem',  // 12px
    lg: '1rem',     // 16px
    xl: '1.375rem', // 22px — matches iOS cornerRadius
    full: '9999px',
  },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.3)',
    md: '0 4px 12px rgba(0,0,0,0.4)',
    lg: '0 10px 20px rgba(0,0,0,0.5)',
    xl: '0 14px 28px rgba(0,0,0,0.6)',
  },
};

/**
 * iOS-matching color references for use across components
 * Maps to AvafliBranding properties from iOS SDK
 */
export interface IOSColors {
  backgroundColor: string;
  cardBackgroundColor: string;
  cardBorderColor: string;
  primaryColor: string;
  secondaryTextColor: string;
  mutedTextColor: string;
  primaryButtonColor: string;
  primaryButtonTextColor: string;
  accentGlowColor: string;
  inputFieldBackgroundColor: string;
  inputFieldBorderColor: string;
  inputFieldPlaceholderColor: string;
  cornerRadius: number;
}

const defaultIOSColors: IOSColors = {
  backgroundColor: '#0D0D0D',
  cardBackgroundColor: '#1A1A2E',
  cardBorderColor: 'rgba(255,255,255,0.12)',
  primaryColor: '#FFFFFF',
  secondaryTextColor: '#E0E0E0',
  mutedTextColor: '#A0A0B0',
  primaryButtonColor: '#5B4CFF',      // vibrant purple CTA
  primaryButtonTextColor: '#FFFFFF',
  accentGlowColor: '#FFD700',         // gold glow
  inputFieldBackgroundColor: '#1A1A2E',
  inputFieldBorderColor: 'rgba(255,255,255,0.15)',
  inputFieldPlaceholderColor: '#6B6B80',
  cornerRadius: 16,
};

/**
 * @deprecated Use createIOSColors(theme) for branding-aware colors
 */
export const iosColors: IOSColors = defaultIOSColors;

/**
 * Create iOS color set derived from the current theme / branding
 */
export function createIOSColors(theme: Theme): IOSColors {
  return {
    ...defaultIOSColors,
    backgroundColor: theme.colors.background,
    primaryColor: theme.colors.primary,
    secondaryTextColor: theme.colors.secondary,
    cardBackgroundColor: theme.colors.surface,
    inputFieldBackgroundColor: theme.colors.surface,
    // The brand accent drives the CTA button + active highlights; the secondary
    // brand color drives the glow. Both come from the publisher/admin branding.
    primaryButtonColor: theme.colors.accent,
    accentGlowColor: theme.colors.accentGlow,
  };
}

/**
 * Create theme from branding configuration
 */
export function createTheme(branding?: AvafliBranding): Theme {
  const theme: Theme = JSON.parse(JSON.stringify(defaultTheme));

  if (branding) {
    // primaryColor is the BRAND ACCENT (CTA, active tile, highlights) — NOT body
    // text. Text stays high-contrast (white) on the dark background.
    if (branding.primaryColor) {
      theme.colors.accent = branding.primaryColor;
      theme.colors.accentGlow = branding.primaryColor;
    }
    if (branding.secondaryColor) {
      theme.colors.secondary = branding.secondaryColor;
      theme.colors.accentGlow = branding.secondaryColor;
    }
    if (branding.backgroundColor) theme.colors.background = branding.backgroundColor;
    if (branding.fontFamily) theme.fonts.family = branding.fontFamily;
  }

  return theme;
}

/**
 * Generate CSS variables from theme
 */
export function generateCSSVariables(theme: Theme): string {
  const derived = createIOSColors(theme);

  const cssVars = [
    `--avafli-color-primary: ${theme.colors.primary};`,
    `--avafli-color-secondary: ${theme.colors.secondary};`,
    `--avafli-color-background: ${theme.colors.background};`,
    `--avafli-color-surface: ${theme.colors.surface};`,
    `--avafli-color-text: ${theme.colors.text};`,
    `--avafli-color-text-secondary: ${theme.colors.textSecondary};`,
    `--avafli-color-success: ${theme.colors.success};`,
    `--avafli-color-error: ${theme.colors.error};`,
    `--avafli-color-warning: ${theme.colors.warning};`,
    `--avafli-font-family: ${theme.fonts.family};`,
    `--avafli-font-size-sm: ${theme.fonts.sizes.sm};`,
    `--avafli-font-size-base: ${theme.fonts.sizes.base};`,
    `--avafli-font-size-lg: ${theme.fonts.sizes.lg};`,
    `--avafli-font-size-xl: ${theme.fonts.sizes.xl};`,
    `--avafli-font-size-2xl: ${theme.fonts.sizes['2xl']};`,
    `--avafli-font-size-3xl: ${theme.fonts.sizes['3xl']};`,
    `--avafli-font-weight-normal: ${theme.fonts.weights.normal};`,
    `--avafli-font-weight-medium: ${theme.fonts.weights.medium};`,
    `--avafli-font-weight-semibold: ${theme.fonts.weights.semibold};`,
    `--avafli-font-weight-bold: ${theme.fonts.weights.bold};`,
    `--avafli-spacing-xs: ${theme.spacing.xs};`,
    `--avafli-spacing-sm: ${theme.spacing.sm};`,
    `--avafli-spacing-md: ${theme.spacing.md};`,
    `--avafli-spacing-lg: ${theme.spacing.lg};`,
    `--avafli-spacing-xl: ${theme.spacing.xl};`,
    `--avafli-spacing-2xl: ${theme.spacing['2xl']};`,
    `--avafli-radius-sm: ${theme.borderRadius.sm};`,
    `--avafli-radius-md: ${theme.borderRadius.md};`,
    `--avafli-radius-lg: ${theme.borderRadius.lg};`,
    `--avafli-radius-xl: ${theme.borderRadius.xl};`,
    `--avafli-radius-full: ${theme.borderRadius.full};`,
    `--avafli-shadow-sm: ${theme.shadows.sm};`,
    `--avafli-shadow-md: ${theme.shadows.md};`,
    `--avafli-shadow-lg: ${theme.shadows.lg};`,
    `--avafli-shadow-xl: ${theme.shadows.xl};`,
    // iOS-specific tokens (derived from theme)
    `--avafli-btn-color: ${derived.primaryButtonColor};`,
    `--avafli-btn-text: ${derived.primaryButtonTextColor};`,
    `--avafli-glow: ${derived.accentGlowColor};`,
    `--avafli-card-bg: ${derived.cardBackgroundColor};`,
    `--avafli-card-border: ${derived.cardBorderColor};`,
    `--avafli-muted: ${derived.mutedTextColor};`,
    `--avafli-input-bg: ${derived.inputFieldBackgroundColor};`,
    `--avafli-input-border: ${derived.inputFieldBorderColor};`,
    `--avafli-input-placeholder: ${derived.inputFieldPlaceholderColor};`,
  ];

  return cssVars.join('\n  ');
}

/**
 * Theme utilities
 */
export const ThemeUtils = {
  isLightColor(color: string): boolean {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return brightness > 155;
  },

  getContrastingTextColor(backgroundColor: string): string {
    return this.isLightColor(backgroundColor) ? '#000000' : '#ffffff';
  },

  lightenColor(color: string, percent: number): string {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const newR = Math.min(255, Math.floor(r + (255 - r) * percent / 100));
    const newG = Math.min(255, Math.floor(g + (255 - g) * percent / 100));
    const newB = Math.min(255, Math.floor(b + (255 - b) * percent / 100));
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  },

  darkenColor(color: string, percent: number): string {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const newR = Math.max(0, Math.floor(r * (100 - percent) / 100));
    const newG = Math.max(0, Math.floor(g * (100 - percent) / 100));
    const newB = Math.max(0, Math.floor(b * (100 - percent) / 100));
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  },
};
