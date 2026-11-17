import { useSearchParams } from 'react-router';
import type { AcademicYearStatus, YearRef } from '@/types/api';
import { formatDate } from '@/utils/format';

/** The year a page is looking at lives in `?year=` so links and reloads keep it. */
export function useYearParam(): [string | undefined, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const year = params.get('year') ?? undefined;
  const setYear = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('year', id);
        else next.delete('year');
        return next;
      },
      { replace: true },
    );
  return [year, setYear];
}

/** Status key for <EntityStatus />: the active year reads as "Current". */
export const yearStatusKey = (status: AcademicYearStatus) => (status === 'active' ? 'current' : status);

/** Completed and archived years are history: the backend refuses structural changes. */
export const isYearEditable = (year: Pick<YearRef, 'status'> | null | undefined) => !!year && (year.status === 'planned' || year.status === 'active');

export const dateRange = (start: string, end: string) => `${formatDate(start)} – ${formatDate(end)}`;

/** Appends `?year=` to a path when a year is chosen. */
export const withYear = (path: string, yearId?: string | null) => (yearId ? `${path}?year=${yearId}` : path);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
