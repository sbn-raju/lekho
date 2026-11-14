export const lekhoTheme = {
  colors: {
    primary: "#2563EB",
    primaryLight: "#3B82F6",
    primaryTint: "#DBEAFE",
    primaryDark: "#1746C8",
    accent: "#F59E0B",
    background: "#F8FAFC",
    surface: "#FFFFFF",
    text: "#0B1736",
    textMuted: "#64748B",
    border: "#E2E8F0",
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    info: "#0EA5E9",
    draft: "#8B5CF6",
    neutral: "#64748B",
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 },
  typography: {
    heading: "Manrope",
    body: "Inter",
  },
} as const;

export type LekhoTheme = typeof lekhoTheme;
