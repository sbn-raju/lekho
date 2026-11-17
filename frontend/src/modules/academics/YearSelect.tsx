import { Select, type SelectProps } from '@mantine/core';
import { useAccess } from '@/services/api/access';
import { useAcademicYears } from '@/services/api/academics';

/**
 * Picks the academic year a page shows. `value` is the year in the URL, or the one the backend
 * resolved (current, else upcoming) when the URL doesn't name one.
 */
export function YearSelect({ value, onChange, ...props }: Omit<SelectProps, 'data' | 'value' | 'onChange'> & { value: string | null | undefined; onChange: (id: string | null) => void }) {
  const canRead = useAccess().canOrg('academic_years.read');
  const years = useAcademicYears(canRead);
  const data = (years.data ?? []).map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} · current` : `${y.name} · ${y.status}` }));
  if (!canRead || (years.data && years.data.length === 0)) return null;
  return (
    <Select
      aria-label="Academic year"
      placeholder="Academic year"
      data={data}
      value={value ?? null}
      onChange={onChange}
      allowDeselect={false}
      w={220}
      comboboxProps={{ withinPortal: true }}
      {...props}
    />
  );
}
