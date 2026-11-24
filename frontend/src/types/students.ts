/** Student Management types. Mirrors backend/src/modules/students. Dates are "YYYY-MM-DD". */
import type { YearRef } from './api';

export type Gender = 'male' | 'female' | 'other' | 'undisclosed';
export type StudentStatus = 'draft' | 'active' | 'inactive' | 'transferred' | 'withdrawn' | 'graduated';
export type GuardianRelationship = 'father' | 'mother' | 'guardian' | 'other';
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export interface Address {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
}

export interface StudentPhoto {
  url: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  mimeType: string;
  size: number;
  version: number;
  uploadedAt: string;
}

export interface Placement {
  id: string;
  studentId: string;
  academicYear: (YearRef & { code: string }) | null;
  class: { id: string; name: string; code: string } | null;
  section: { id: string; name: string; code: string; room: string | null } | null;
  startDate: string;
  endDate: string | null;
  status: 'active' | 'superseded' | 'completed';
  assignmentType: 'admission' | 'promotion' | 'retention' | 'transfer' | 'readmission' | 'placement';
  outcome: 'promoted' | 'retained' | 'transferred' | 'withdrawn' | 'graduated' | null;
  previousAssignmentId: string | null;
  notes: string | null;
  corrections: { reason: string; before: Record<string, unknown>; correctedBy: string; correctedAt: string }[];
  createdAt: string;
}

export interface PrimaryContact {
  name: string;
  relationship: GuardianRelationship;
  mobileNumber: string | null;
  verified: boolean;
}

export interface StudentSummary {
  id: string;
  admissionNumber: string | null;
  admittedAt: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  fullName: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: Gender | null;
  bloodGroup: BloodGroup | null;
  nationality: string | null;
  motherTongue: string | null;
  addresses: { residential: Address | null; permanent: Address | null; permanentSameAsResidential: boolean };
  previousSchool: string | null;
  previousClass: string | null;
  photo: StudentPhoto | null;
  status: StudentStatus;
  registrationStatus: 'draft' | 'completed';
  statusReason: string | null;
  statusChangedAt: string | null;
  archived: boolean;
  archivedAt: string | null;
  currentAssignment: Placement | null;
  /** Null when the viewer can't see contact details. */
  primaryContact?: PrimaryContact | null;
  hasVerifiedContact?: boolean;
  /** Only for viewers with students.read_sensitive. */
  sensitive?: { religion: string | null; casteCategory: string | null; caste: string | null; medicalNotes: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface StudentDetail extends StudentSummary {
  registration: { complete: boolean; missing: { field: string; message: string }[] };
  permissions: { sensitive: boolean; guardians: boolean };
}

export interface Guardian {
  id: string;
  studentId: string;
  fullName: string;
  relationship: GuardianRelationship;
  relationshipLabel: string | null;
  mobileNumber: string | null;
  alternateMobileNumber: string | null;
  email: string | null;
  occupation: string | null;
  address: Address | null;
  isPrimaryContact: boolean;
  isEmergencyContact: boolean;
  verificationStatus: 'verified' | 'unverified';
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OtpSent {
  sentTo: string;
  expiresAt: string;
  resendAvailableAt: string;
  attemptsAllowed: number;
  codeLength: number;
}

export interface StudentProfile {
  student: StudentDetail;
  guardians: Guardian[] | null;
  assignments: Placement[];
  admission: { admissionNumber: string | null; admittedAt: string | null; history: { from: string; to: string; reason: string; changedBy: string; changedAt: string }[] };
  idCards: { id: string; version: number; generatedAt: string; generatedBy: string; templateId: string | null; academicAssignmentId: string }[];
}

export interface StudentStats {
  total: number;
  byStatus: Record<StudentStatus, number>;
  activeWithoutPhoto: number;
  activeWithoutVerifiedContact: number;
  activeUnplacedInCurrentYear: number | null;
  currentAcademicYear: { id: string; name: string } | null;
}

export interface MySections {
  academicYear: YearRef | null;
  sections: {
    id: string;
    name: string;
    code: string;
    class: { id: string; name: string; code: string } | null;
    classTeacher: { id: string; name: string; email: string } | null;
    capacity: number;
    room: string | null;
    studentCount: number;
  }[];
}

export interface StudentHistoryEntry {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

export interface StudentSettings {
  admissionNumber: { format: string; sequencePadding: number };
  casteCategories: string[];
  allowUndisclosedGender: boolean;
  admissionNumberPreview: string;
  updatedAt: string | null;
}

export const ID_CARD_FIELDS = ['admissionNumber', 'class', 'section', 'academicYear', 'dateOfBirth', 'bloodGroup', 'schoolAddress', 'schoolPhone', 'schoolEmail', 'emergencyContact', 'validUntil'] as const;
export type IdCardField = (typeof ID_CARD_FIELDS)[number];

export interface IdCardTemplate {
  id: string;
  name: string;
  layout: 'portrait' | 'landscape';
  primaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  photoPosition: 'left' | 'center' | 'right';
  fields: IdCardField[];
  showBackSide: boolean;
  backText: string | null;
  signatureLabel: string | null;
  validUntil: string | null;
  isDefault: boolean;
  builtIn: boolean;
}

export interface IdCardData {
  studentId: string;
  assignmentId: string;
  name: string;
  admissionNumber: string;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  className: string;
  sectionName: string;
  academicYear: string;
  emergencyContact: string | null;
  validUntil: string | null;
  photoUrl: string | null;
  photoVersion: number | null;
}

export interface IdCardPreview {
  template: IdCardTemplate;
  school: { name: string; address: string; phone: string | null; email: string | null; code: string };
  card: IdCardData | null;
  eligible: boolean;
  problems: { reason: string; message: string }[];
}

export interface BulkIdCardSummary {
  academicYear: { id: string; name: string };
  eligible: number;
  skipped: { studentId: string; name: string; reason: string; message: string }[];
}

export interface PhotoUploadAuth {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
  urlEndpoint: string;
  folder: string;
  fileName: string;
  isPrivateFile: boolean;
  useUniqueFileName: boolean;
  constraints: { maxBytes: number; mimeTypes: string[]; recommended: { width: number; height: number; aspectRatio: string } };
}
