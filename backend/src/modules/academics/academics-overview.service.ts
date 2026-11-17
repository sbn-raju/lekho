import { Types } from 'mongoose';
import { AcademicYearModel, ACADEMIC_YEAR_STATUSES } from './academic-year.model.js';
import { resolveYear } from './academics.shared.js';
import { classService } from './class.service.js';

/**
 * The academic setup dashboard: what's configured for a year (the current one by default) and
 * what's still missing, as a checklist a new school can work through.
 */
export const academicsOverviewService = {
  async overview(organizationId: string, academicYearId?: string) {
    const year = await resolveYear(organizationId, academicYearId);
    const [statusRows, classes] = await Promise.all([
      AcademicYearModel.aggregate<{ _id: string; n: number }>([{ $match: { organizationId: new Types.ObjectId(organizationId) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      classService.list(organizationId, { academicYearId: year ? String(year._id) : undefined }),
    ]);
    const years = Object.fromEntries(ACADEMIC_YEAR_STATUSES.map((s) => [s, statusRows.find((r) => r._id === s)?.n ?? 0])) as Record<(typeof ACADEMIC_YEAR_STATUSES)[number], number>;
    const totalYears = Object.values(years).reduce((a, b) => a + b, 0);

    const active = classes.items.filter((c) => c.status === 'active');
    const sum = (key: 'sectionCount' | 'totalCapacity' | 'sectionsWithoutClassTeacher') => active.reduce((n, c) => n + (c[key] as number), 0);
    const sections = sum('sectionCount');
    const withoutTeacher = sum('sectionsWithoutClassTeacher');
    const classesWithoutSections = active.filter((c) => c.sectionCount === 0).length;

    return {
      academicYear: year
        ? { id: String(year._id), name: year.name, status: year.status, startDate: year.startDate.toISOString().slice(0, 10), endDate: year.endDate.toISOString().slice(0, 10), termCount: year.terms.length }
        : null,
      years: { total: totalYears, ...years },
      totals: {
        classes: classes.items.length,
        activeClasses: active.length,
        sections,
        totalCapacity: sum('totalCapacity'),
        averageSectionCapacity: sections ? Math.round(sum('totalCapacity') / sections) : 0,
        sectionsWithoutClassTeacher: withoutTeacher,
        classesWithoutSections,
      },
      byClass: active.map((c) => ({ classId: c.id, name: c.name, code: c.code, sectionCount: c.sectionCount, totalCapacity: c.totalCapacity, sectionsWithoutClassTeacher: c.sectionsWithoutClassTeacher })),
      checklist: [
        { key: 'academic_year', label: 'Create an academic year', done: totalYears > 0 },
        { key: 'current_year', label: 'Set the current academic year', done: years.active > 0 },
        { key: 'classes', label: 'Add classes', done: active.length > 0 },
        { key: 'sections', label: 'Give every class at least one section', done: active.length > 0 && classesWithoutSections === 0 },
        { key: 'class_teachers', label: 'Assign a class teacher to every section', done: sections > 0 && withoutTeacher === 0 },
      ],
    };
  },
};
