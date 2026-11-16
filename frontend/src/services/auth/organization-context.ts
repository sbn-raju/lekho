import { useSyncExternalStore } from 'react';

/**
 * Which school this browser tab is working in. Sent as `X-Organization-Id` on every request, so two
 * tabs can work in two schools at once. Kept in sessionStorage (per tab); the last choice is also
 * remembered in localStorage to preselect it in new tabs.
 */
const TAB_KEY = 'lekho.organizationId';
const LAST_KEY = 'lekho.lastOrganizationId';

const listeners = new Set<() => void>();

function read(key: string, storage: () => Storage): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, storage: () => Storage) {
  try {
    if (value) storage().setItem(key, value);
    else storage().removeItem(key);
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
}

let current: string | null = read(TAB_KEY, () => sessionStorage);

export function getActiveOrganizationId(): string | null {
  return current;
}

export function getLastOrganizationId(): string | null {
  return read(LAST_KEY, () => localStorage);
}

export function setActiveOrganizationId(id: string | null): void {
  current = id;
  write(TAB_KEY, id, () => sessionStorage);
  if (id) write(LAST_KEY, id, () => localStorage);
  listeners.forEach((l) => l());
}

/** Forget the selection entirely (sign-out). */
export function clearOrganizationContext(): void {
  setActiveOrganizationId(null);
  write(LAST_KEY, null, () => localStorage);
}

export function useActiveOrganizationId(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
