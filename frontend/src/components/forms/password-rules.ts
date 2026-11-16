import { hasLength, matchesField } from '@mantine/form';

/** Backend policy (auth.validators.ts): 12–128 characters, no composition rules. */
export const PASSWORD_RULES = {
  password: hasLength({ min: 12, max: 128 }, 'Use at least 12 characters'),
  confirmPassword: matchesField('password', 'Passwords do not match'),
};
