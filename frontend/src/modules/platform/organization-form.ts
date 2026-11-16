import { hasLength, isEmail, matches, useForm } from '@mantine/form';
import type { OrganizationInput } from '@/services/api/platform';
import type { PlatformOrganization } from '@/types/api';

export interface OrganizationValues {
  name: string;
  slug: string;
  code: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  timezone: string;
  academicYear: string;
}

export const TIMEZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Asia/Kolkata', 'UTC'];
  }
})();

export const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

export function useOrganizationForm(org?: PlatformOrganization) {
  return useForm<OrganizationValues>({
    mode: 'uncontrolled',
    initialValues: {
      name: org?.name ?? '',
      slug: org?.slug ?? '',
      code: org?.code ?? '',
      email: org?.contact.email ?? '',
      phone: org?.contact.phone ?? '',
      line1: org?.address.line1 ?? '',
      city: org?.address.city ?? '',
      state: org?.address.state ?? '',
      country: org?.address.country ?? 'India',
      postalCode: org?.address.postalCode ?? '',
      timezone: org?.settings.timezone ?? 'Asia/Kolkata',
      academicYear: org?.settings.academicYear ?? '',
    },
    validate: {
      name: hasLength({ min: 2, max: 200 }, 'Use 2–200 characters'),
      slug: matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens (min 3)'),
      code: matches(/^[A-Za-z0-9_-]{2,20}$/, '2–20 letters, digits, hyphens or underscores'),
      email: isEmail('Enter a valid email address'),
    },
  });
}

export function toOrganizationInput(v: OrganizationValues): OrganizationInput {
  const opt = (s: string) => s.trim() || undefined;
  return {
    name: v.name.trim(),
    slug: v.slug.trim(),
    code: v.code.trim().toUpperCase(),
    contact: { email: v.email.trim(), phone: opt(v.phone) },
    address: { line1: opt(v.line1), city: opt(v.city), state: opt(v.state), country: opt(v.country), postalCode: opt(v.postalCode) },
    settings: { timezone: v.timezone, academicYear: opt(v.academicYear) },
  };
}

