import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from './client';
import { keys } from './keys';
import type { Paginated } from '@/types/api';
import type {
  Address,
  BulkIdCardSummary,
  Guardian,
  GuardianRelationship,
  IdCardField,
  IdCardPreview,
  IdCardTemplate,
  MySections,
  OtpSent,
  PhotoUploadAuth,
  Placement,
  StudentDetail,
  StudentHistoryEntry,
  StudentPhoto,
  StudentProfile,
  StudentSettings,
  StudentStats,
  StudentStatus,
  StudentSummary,
} from '@/types/students';

/** Student Management in the active school (backend FRD §14). */
export interface StudentFilters {
  page: number;
  limit?: number;
  search?: string;
  academicYearId?: string;
  classId?: string;
  sectionId?: string;
  gender?: string;
  status?: string;
  verification?: 'verified' | 'unverified';
  archived?: boolean;
  sort?: 'name' | 'admissionNumber' | 'recent';
}

export interface StudentInput {
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  bloodGroup?: string | null;
  nationality?: string | null;
  motherTongue?: string | null;
  religion?: string | null;
  casteCategory?: string | null;
  caste?: string | null;
  medicalNotes?: string | null;
  residentialAddress?: Address;
  permanentAddress?: Address | null;
  permanentSameAsResidential?: boolean;
  previousSchool?: string | null;
  previousClass?: string | null;
}

export interface GuardianInput {
  fullName?: string;
  relationship?: GuardianRelationship;
  relationshipLabel?: string | null;
  mobileNumber?: string | null;
  alternateMobileNumber?: string | null;
  email?: string | null;
  occupation?: string | null;
  isPrimaryContact?: boolean;
  isEmergencyContact?: boolean;
}

export interface PlacementInput {
  academicYearId: string;
  classId: string;
  sectionId: string;
  startDate?: string;
  assignmentType?: Placement['assignmentType'];
  notes?: string;
  allowOverCapacity?: boolean;
}

export type TemplateInput = Partial<Omit<IdCardTemplate, 'id' | 'builtIn'>> & { fields?: IdCardField[] };

const s = (id: string) => `/students/${id}`;

export const studentsApi = {
  list: (f: StudentFilters) => api.get<Paginated<StudentSummary>>(`/students${qs({ limit: 20, ...f })}`),
  stats: () => api.get<StudentStats>('/students/stats'),
  mySections: (academicYearId?: string) => api.get<MySections>(`/students/my-sections${qs({ academicYearId })}`),
  get: (id: string) => api.get<StudentDetail>(s(id)),
  profile: (id: string) => api.get<StudentProfile>(`${s(id)}/profile`),
  history: (id: string, page: number) => api.get<Paginated<StudentHistoryEntry>>(`${s(id)}/history${qs({ page, limit: 20 })}`),
  create: (body: StudentInput & { firstName: string }) => api.post<StudentDetail>('/students', body),
  update: (id: string, body: StudentInput) => api.patch<StudentDetail>(s(id), body),
  completeRegistration: (id: string, assignment?: PlacementInput) => api.post<StudentDetail>(`${s(id)}/complete-registration`, { assignment }),
  setStatus: (id: string, body: { status: Exclude<StudentStatus, 'draft'>; reason?: string; effectiveDate?: string }) => api.patch<StudentDetail>(`${s(id)}/status`, body),
  remove: (id: string, reason?: string) => api.delete<{ deleted: boolean; archived: boolean }>(s(id), { body: { reason } }),
  restore: (id: string) => api.post<StudentDetail>(`${s(id)}/restore`),
  correctAdmissionNumber: (id: string, body: { admissionNumber: string; reason: string }) => api.patch(`${s(id)}/admission-number`, body),

  guardians: (id: string) => api.get<Guardian[]>(`${s(id)}/guardians`),
  addGuardian: (id: string, body: GuardianInput & { fullName: string; relationship: GuardianRelationship }) => api.post<Guardian>(`${s(id)}/guardians`, body),
  updateGuardian: (id: string, guardianId: string, body: GuardianInput) => api.patch<Guardian>(`${s(id)}/guardians/${guardianId}`, body),
  removeGuardian: (id: string, guardianId: string) => api.delete(`${s(id)}/guardians/${guardianId}`),
  sendOtp: (id: string, guardianId: string) => api.post<OtpSent>(`${s(id)}/guardians/${guardianId}/send-otp`),
  verifyOtp: (id: string, guardianId: string, otp: string) => api.post<Guardian>(`${s(id)}/guardians/${guardianId}/verify-otp`, { otp }),

  assignments: (id: string) => api.get<Placement[]>(`${s(id)}/assignments`),
  assign: (id: string, body: PlacementInput) => api.post<Placement>(`${s(id)}/assignments`, body),
  transfer: (id: string, body: { sectionId: string; effectiveDate?: string; reason?: string; allowOverCapacity?: boolean }) => api.post<Placement>(`${s(id)}/transfer`, body),
  correctAssignment: (id: string, assignmentId: string, body: { classId?: string; sectionId?: string; startDate?: string; endDate?: string | null; notes?: string | null; reason: string }) =>
    api.patch<Placement>(`${s(id)}/assignments/${assignmentId}`, body),
  closeAssignment: (id: string, assignmentId: string, body: { outcome: 'promoted' | 'retained'; endDate?: string }) => api.post<Placement>(`${s(id)}/assignments/${assignmentId}/close`, body),
  bulkPromote: (body: { fromSectionId: string; toSectionId: string; studentIds?: string[]; assignmentType?: 'promotion' | 'retention'; allowOverCapacity?: boolean }) =>
    api.post<{ placed: number; skipped: { studentId: string; name: string; reason: string }[] }>('/students/bulk-promote', body),

  photoAuth: (studentId: string) => api.post<PhotoUploadAuth>('/uploads/student-photo/auth', { studentId }),
  savePhoto: (id: string, fileId: string) => api.post<StudentPhoto & { warnings: string[] }>(`${s(id)}/photo`, { fileId }),
  removePhoto: (id: string) => api.delete(`${s(id)}/photo`),

  idCard: (id: string, templateId?: string) => api.get<IdCardPreview>(`${s(id)}/id-card${qs({ templateId })}`),
  generateIdCard: (id: string, templateId?: string) => api.downloadPost(`${s(id)}/id-card/generate`, { templateId }, 'id-card.pdf'),
  bulkIdCardsSummary: (body: BulkIdCardsInput) => api.post<BulkIdCardSummary>('/students/id-cards/bulk-generate', { ...body, dryRun: true }),
  bulkIdCards: (body: BulkIdCardsInput) => api.downloadPost('/students/id-cards/bulk-generate', body, 'id-cards.pdf'),
  templates: () => api.get<IdCardTemplate[]>('/id-card-templates'),
  createTemplate: (body: TemplateInput & { name: string }) => api.post<IdCardTemplate>('/id-card-templates', body),
  updateTemplate: (id: string, body: TemplateInput) => api.patch<IdCardTemplate>(`/id-card-templates/${id}`, body),
  deleteTemplate: (id: string) => api.delete(`/id-card-templates/${id}`),

  settings: () => api.get<StudentSettings>('/settings/admission-number'),
  updateSettings: (body: { format?: string; sequencePadding?: number; casteCategories?: string[]; allowUndisclosedGender?: boolean }) => api.patch<StudentSettings>('/settings/admission-number', body),
};

export interface BulkIdCardsInput {
  academicYearId?: string;
  classId?: string;
  sectionId?: string;
  studentIds?: string[];
  includeInactive?: boolean;
  templateId?: string;
}

// Mutations use useSchoolMutation (services/api/school.ts), which refreshes all school data.

export function useStudents(f: StudentFilters, enabled = true) {
  return useQuery({ queryKey: keys.org('students', 'list', f), queryFn: () => studentsApi.list(f), placeholderData: keepPreviousData, enabled });
}

export function useStudentStats(enabled = true) {
  return useQuery({ queryKey: keys.org('students', 'stats'), queryFn: studentsApi.stats, enabled });
}

export function useMySections(academicYearId?: string) {
  return useQuery({ queryKey: keys.org('students', 'my-sections', academicYearId ?? null), queryFn: () => studentsApi.mySections(academicYearId), placeholderData: keepPreviousData });
}

export function useStudent(id: string | undefined) {
  return useQuery({ queryKey: keys.org('students', id), queryFn: () => studentsApi.get(id!), enabled: !!id });
}

export function useStudentProfile(id: string) {
  return useQuery({ queryKey: keys.org('students', id, 'profile'), queryFn: () => studentsApi.profile(id) });
}

export function useStudentHistory(id: string, page: number, enabled = true) {
  return useQuery({ queryKey: keys.org('students', id, 'history', page), queryFn: () => studentsApi.history(id, page), placeholderData: keepPreviousData, enabled });
}

export function useGuardians(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: keys.org('students', id, 'guardians'), queryFn: () => studentsApi.guardians(id!), enabled: enabled && !!id });
}

export function useIdCardPreview(id: string, templateId?: string, enabled = true) {
  return useQuery({ queryKey: keys.org('students', id, 'id-card', templateId ?? null), queryFn: () => studentsApi.idCard(id, templateId), enabled, placeholderData: keepPreviousData });
}

export function useIdCardTemplates(enabled = true) {
  return useQuery({ queryKey: keys.org('students', 'id-card-templates'), queryFn: studentsApi.templates, enabled });
}

export function useStudentSettings(enabled = true) {
  return useQuery({ queryKey: keys.org('students', 'settings'), queryFn: studentsApi.settings, enabled });
}
