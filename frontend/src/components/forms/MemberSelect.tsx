import { Select, type SelectProps } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useState } from 'react';
import { useSchoolUsers } from '@/services/api/school';
import { fullName } from '@/utils/format';

/** Searchable picker over the school's members (server-side search, limited to the caller's scope). */
export function MemberSelect({ value, onChange, exclude = [], ...props }: Omit<SelectProps, 'data' | 'onChange'> & { value: string | null; onChange: (id: string | null) => void; exclude?: string[] }) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const users = useSchoolUsers({ page: 1, search: debounced || undefined, status: 'active' });
  const data = (users.data?.items ?? []).filter((u) => !exclude.includes(u.id)).map((u) => ({ value: u.id, label: `${fullName(u)} · ${u.email}` }));
  return (
    <Select
      searchable
      clearable
      placeholder="Search by name or email"
      nothingFoundMessage={users.isFetching ? 'Searching…' : 'No matching members'}
      filter={({ options }) => options}
      searchValue={search}
      onSearchChange={setSearch}
      data={data}
      value={value}
      onChange={onChange}
      {...props}
    />
  );
}
