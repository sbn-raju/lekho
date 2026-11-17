/** Quick-start class lists for common school structures. Codes are what the backend stores. */
export interface ClassTemplate {
  key: string;
  label: string;
  description: string;
  classes: { name: string; code: string }[];
}

const grades = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ name: `Grade ${from + i}`, code: `G${from + i}` }));
const prePrimary = [
  { name: 'Nursery', code: 'NUR' },
  { name: 'LKG', code: 'LKG' },
  { name: 'UKG', code: 'UKG' },
];

export const CLASS_TEMPLATES: ClassTemplate[] = [
  { key: 'k12', label: 'Nursery to Grade 12', description: 'Pre-primary plus Grades 1–12', classes: [...prePrimary, ...grades(1, 12)] },
  { key: 'g1-12', label: 'Grade 1 to 12', description: 'Primary through senior secondary', classes: grades(1, 12) },
  { key: 'g1-10', label: 'Grade 1 to 10', description: 'Primary through secondary', classes: grades(1, 10) },
  { key: 'g1-5', label: 'Grade 1 to 5', description: 'Primary school', classes: grades(1, 5) },
  { key: 'pre', label: 'Pre-primary', description: 'Nursery, LKG and UKG', classes: prePrimary },
];
