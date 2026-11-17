import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from './client';
import { keys } from './keys';
import type { AcademicsOverview, AcademicYear, AcademicYearStatus, ClassDetail, ClassList, SchoolClass, Section } from '@/types/api';

/** Academic years, classes and sections in the active school. Dates are "YYYY-MM-DD". */
export interface YearInput {
  name: string;
  code?: string;
  startDate: string;
  endDate: string;
  terms?: { name: string; startDate: string; endDate: string }[];
}

export interface ClassInput {
  name: string;
  code: string;
  description?: string | null;
  defaultSectionCapacity?: number;
  status?: 'active' | 'inactive';
}

export interface SectionInput {
  name?: string;
  code?: string;
  capacity?: number;
  room?: string | null;
  status?: 'active' | 'inactive';
}

export interface BulkSectionsInput {
  academicYearId: string;
  naming: 'alphabetic' | 'numeric';
  items: { classId: string; sectionCount: number; capacity?: number }[];
}

export const academicsApi = {
  overview: (academicYearId?: string) => api.get<AcademicsOverview>(`/academics/overview${qs({ academicYearId })}`),

  years: () => api.get<AcademicYear[]>('/academic-years'),
  createYear: (body: YearInput) => api.post<AcademicYear>('/academic-years', body),
  updateYear: (id: string, body: Partial<YearInput>) => api.patch<AcademicYear>(`/academic-years/${id}`, body),
  setYearStatus: (id: string, status: AcademicYearStatus, closeCurrent?: boolean) => api.patch<AcademicYear>(`/academic-years/${id}/status`, { status, closeCurrent }),
  deleteYear: (id: string) => api.delete(`/academic-years/${id}`),
  copyStructure: (id: string, sourceAcademicYearId: string) =>
    api.post<{ created: number; skipped: number }>(`/academic-years/${id}/copy-structure`, { sourceAcademicYearId }),

  classes: (academicYearId?: string) => api.get<ClassList>(`/classes${qs({ academicYearId })}`),
  class: (id: string, academicYearId?: string) => api.get<ClassDetail>(`/classes/${id}${qs({ academicYearId })}`),
  createClass: (body: ClassInput) => api.post<SchoolClass>('/classes', body),
  createClasses: (classes: ClassInput[]) => api.post<SchoolClass[]>('/classes/bulk', { classes }),
  updateClass: (id: string, body: Partial<ClassInput>) => api.patch<ClassDetail>(`/classes/${id}`, body),
  reorderClasses: (classIds: string[]) => api.put<SchoolClass[]>('/classes/order', { classIds }),
  deleteClass: (id: string) => api.delete(`/classes/${id}`),

  sections: (f: { academicYearId?: string; classId?: string }) => api.get<Section[]>(`/sections${qs(f)}`),
  createSection: (body: SectionInput & { academicYearId: string; classId: string; name: string }) => api.post<Section>('/sections', body),
  bulkSections: (body: BulkSectionsInput) => api.post<{ created: Section[]; skipped: { classId: string; existing: number }[] }>('/sections/bulk', body),
  updateSection: (id: string, body: SectionInput) => api.patch<Section>(`/sections/${id}`, body),
  setClassTeacher: (id: string, userId: string | null) => api.put<Section>(`/sections/${id}/class-teacher`, { userId }),
  deleteSection: (id: string) => api.delete(`/sections/${id}`),
};

// Mutations use useSchoolMutation (services/api/school.ts), which refreshes all school data.

export function useAcademicsOverview(academicYearId?: string, enabled = true) {
  return useQuery({ queryKey: keys.org('academics', 'overview', academicYearId ?? null), queryFn: () => academicsApi.overview(academicYearId), enabled, placeholderData: keepPreviousData });
}

export function useAcademicYears(enabled = true) {
  return useQuery({ queryKey: keys.org('academics', 'years'), queryFn: academicsApi.years, enabled });
}

export function useClasses(academicYearId?: string, enabled = true) {
  return useQuery({ queryKey: keys.org('academics', 'classes', academicYearId ?? null), queryFn: () => academicsApi.classes(academicYearId), enabled, placeholderData: keepPreviousData });
}

export function useClassDetail(id: string, academicYearId?: string) {
  return useQuery({ queryKey: keys.org('academics', 'classes', id, academicYearId ?? null), queryFn: () => academicsApi.class(id, academicYearId), placeholderData: keepPreviousData });
}

export function useSections(academicYearId: string | undefined, enabled = true) {
  return useQuery({ queryKey: keys.org('academics', 'sections', academicYearId ?? null), queryFn: () => academicsApi.sections({ academicYearId }), enabled: enabled && !!academicYearId });
}
