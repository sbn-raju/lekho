import { z } from 'zod';
import { paginationQuery } from '../../common/utils/pagination.js';
import { ORGANIZATION_STATUSES } from './organization.model.js';

const optionalText = (max: number) => z.string().trim().max(max).optional();

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown IANA timezone');

const contact = z.object({
  email: z.string().trim().pipe(z.email().max(254)),
  phone: optionalText(30),
});

const address = z.object({
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  postalCode: optionalText(20),
});

const settings = z.object({
  timezone: timezone.optional(),
  academicYear: optionalText(20),
  hierarchyMaxDepth: z.number().int().min(1).max(10).optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single hyphens only')
    .min(3)
    .max(63),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]+$/, 'Letters, digits, hyphen and underscore only')
    .min(2)
    .max(20),
  contact,
  address: address.optional(),
  logo: z.url().max(2048).optional(),
  settings: settings.optional(),
  /** Screen 3 "Save draft": keep onboarding at `draft` until the platform is ready to provision. */
  saveAsDraft: z.boolean().optional(),
});

export const updateOrganizationPlatformSchema = createOrganizationSchema
  .omit({ saveAsDraft: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** What a School Admin may change about their own school. Identity fields (slug, code) stay with the platform. */
export const updateOrganizationSelfSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    contact: contact.partial().optional(),
    address: address.optional(),
    logo: z.url().max(2048).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const updateSettingsSchema = settings.refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const organizationStatusSchema = z.object({
  status: z.enum(ORGANIZATION_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const listOrganizationsQuery = paginationQuery.extend({
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
});

export const provisionAdminSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().pipe(z.email().max(254)),
  phone: optionalText(30),
  invitationExpiryDays: z.number().int().min(1).max(30).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationPlatformInput = z.infer<typeof updateOrganizationPlatformSchema>;
export type UpdateOrganizationSelfInput = z.infer<typeof updateOrganizationSelfSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type ProvisionAdminInput = z.infer<typeof provisionAdminSchema>;
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuery>;
