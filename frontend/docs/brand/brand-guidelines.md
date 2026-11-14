# Lekho Brand Guidelines

## Brand foundation
- Brand: Lekho
- Category: School Management + Learning Management Platform
- Audience: school leaders and administrators, teachers, students, and parents
- Approved tagline: **A Complete School & LMS Platform.**
- Brand promise: one connected place to manage school operations and support learning.

## Logo system
The primary mark combines an open book with a bookmark. The book signals learning; the bookmark signals saved knowledge and progress.
- `logos/lekho-primary.svg`: use on white/light backgrounds.
- `logos/lekho-dark-background.svg`: use on dark/navy backgrounds.
- `logos/lekho-symbol.svg`: use when the wordmark will not fit (sidebar, avatar, app splash).
- `logos/lekho-monochrome.svg`: one-colour applications only.
- `app-icons/lekho-app-icon.svg`: app icon master.
- `app-icons/favicon.svg`: favicon master.

Keep clear space around the mark at least equal to the bookmark width. Never stretch, rotate, add shadows to, or recolour the logo outside the supplied variants. Do not place the primary logo on busy imagery. Use the symbol alone only where the Lekho name is already clear from context.

The SVGs are editable vector starting assets. Before trademark filing or large-scale print production, have the final geometry reviewed by a brand designer and export required platform-specific raster sizes.

## Colour palette
| Token | Hex | Usage |
|---|---|---|
| Primary | `#2563EB` | Main actions, links, active navigation |
| Primary light | `#3B82F6` | Hover and secondary emphasis |
| Primary tint | `#DBEAFE` | Selected surfaces, subtle highlights |
| Primary dark | `#1746C8` | Pressed states, dark blue emphasis |
| Accent | `#F59E0B` | Small highlights, bookmark, attention |
| Background | `#F8FAFC` | App canvas |
| Surface | `#FFFFFF` | Cards and panels |
| Text | `#0B1736` | Primary text |
| Muted text | `#64748B` | Secondary text |
| Border | `#E2E8F0` | Dividers and outlines |
| Success | `#10B981` | Success and completed |
| Error | `#EF4444` | Errors and destructive states |
| Info | `#0EA5E9` | Informational states |
| Draft | `#8B5CF6` | Draft state |
| Neutral | `#64748B` | Inactive/archived |

Use white and neutral surfaces as the majority of the interface. Blue is the primary interaction colour; yellow is an accent, not a second primary. Do not rely on colour alone to communicate status—always include text and, where useful, an icon.

## Typography
- Headings and brand display: Manrope (600–800).
- Body, forms, tables, and dense UI: Inter (400–600).
- Recommended body size: 14–16px; helper text: 12–13px; page title: 24–32px.
- Use sentence case. Avoid all-caps labels except compact metadata.

## Web application guidance
- Page canvas: `#F8FAFC`; cards: white; border: `#E2E8F0`.
- Sidebar: white or very pale blue; active item: blue-tinted surface with blue icon/text.
- Primary button: blue fill, white text. Secondary: white with border. Tertiary: text-only.
- Use 10–14px corner radii for controls and cards; 20px only for larger feature panels.
- Tables should prioritize scanability: clear column labels, restrained row separators, aligned numeric values, and persistent filters.
- Keep dashboards information-dense but calm. Reserve large illustrations and gradients for marketing and onboarding.

## React Native guidance
- Reuse the same colour, spacing, radius, and typography tokens from `tokens/lekho.theme.ts`.
- Use the symbol for launcher/splash contexts; keep the full wordmark on onboarding and sign-in screens.
- Respect safe areas, platform navigation conventions, dynamic text sizing, and touch targets of at least 44x44pt (iOS) / 48x48dp (Android).
- Use accessible labels for icon-only actions. Support system font scaling and sufficient contrast.
- Keep mobile navigation task-oriented: Home, Learning/Courses, Tasks, Notifications, Profile (adapt to the user's role).
- Do not shrink the desktop sidebar into a tiny mobile sidebar; use bottom navigation or a drawer.

## Product status language
Use consistent status semantics across modules:
- Active / Present / Paid / Completed: success green.
- Pending / Late / Due soon: warning amber.
- Overdue / Failed / Suspended / Cancelled: error red.
- Draft: violet.
- Inactive / Archived: neutral.
- Informational / Submitted / In progress: blue or cyan.

Always pair status colour with a readable label. Define domain-specific status text carefully: for example, a fee marked `Overdue` is not the same as a payment marked `Failed`.

## Voice and messaging
- Clear, supportive, practical, and inclusive.
- Prefer plain language over education-industry jargon.
- Speak to all roles: administrators organize, teachers teach, students learn, and parents stay informed.
- Avoid claims such as “guaranteed results” or “the best school platform” unless substantiated.

## Approved tagline
**A Complete School & LMS Platform.**

Suggested supporting message: “Bring school operations, teaching, and learning together in one connected platform.”

## Asset maintenance
Keep the logo masters and tokens in version control. Treat these files as the source of truth. If a brand token changes, update web and mobile theme implementations together.
