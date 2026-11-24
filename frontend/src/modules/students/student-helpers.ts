import type { Address, IdCardData, Gender, GuardianRelationship, Placement, StudentStatus } from '@/types/students';

export const GENDER_LABEL: Record<Gender, string> = { male: 'Male', female: 'Female', other: 'Other', undisclosed: 'Prefer not to disclose' };
export const RELATIONSHIP_LABEL: Record<GuardianRelationship, string> = { father: 'Father', mother: 'Mother', guardian: 'Guardian', other: 'Other contact' };
export const STATUS_LABEL: Record<StudentStatus, string> = { draft: 'Draft', active: 'Active', inactive: 'Inactive', transferred: 'Transferred', withdrawn: 'Withdrawn', graduated: 'Graduated' };
export const PLACEMENT_TYPE_LABEL: Record<Placement['assignmentType'], string> = {
  admission: 'Admission',
  promotion: 'Promotion',
  retention: 'Retained',
  transfer: 'Section transfer',
  readmission: 'Re-admission',
  placement: 'Placement',
};
export const OUTCOME_LABEL: Record<NonNullable<Placement['outcome']>, string> = {
  promoted: 'Promoted',
  retained: 'Retained',
  transferred: 'Left (transferred)',
  withdrawn: 'Withdrawn',
  graduated: 'Graduated',
};

export const genderOptions = (allowUndisclosed = true) =>
  (Object.keys(GENDER_LABEL) as Gender[]).filter((g) => allowUndisclosed || g !== 'undisclosed').map((g) => ({ value: g, label: GENDER_LABEL[g] }));

/** "+919876543210" → "+91 98765 43210" for Indian numbers; others unchanged. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = e164.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : e164;
}

export function addressText(a: Address | null | undefined): string {
  if (!a) return '—';
  const parts = [a.line1, a.line2, a.city, a.district, a.state, a.postalCode, a.country].filter((p) => p && p.trim());
  return parts.length ? parts.join(', ') : '—';
}

export const placementText = (p: Placement | null | undefined) => (p?.class ? `${p.class.name} – ${p.section?.name ?? ''}` : '—');


/** Sample data for previewing templates in settings. */
export const SAMPLE_CARD: IdCardData = {
  studentId: 'sample',
  assignmentId: 'sample',
  name: 'Ananya Sharma',
  admissionNumber: 'LEKHO-2026-0001',
  dateOfBirth: '2014-08-14',
  bloodGroup: 'B+',
  className: 'Grade 5',
  sectionName: 'A',
  academicYear: '2026-27',
  emergencyContact: '+91 98765 43210',
  validUntil: '2027-03-31',
  photoUrl: null,
  photoVersion: null,
};
