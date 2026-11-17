import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function formatDate(value: string | null | undefined): string {
  return value ? dayjs(value).format('D MMM YYYY') : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dayjs(value).format('D MMM YYYY, HH:mm') : '—';
}

export function fromNow(value: string | null | undefined): string {
  return value ? dayjs(value).fromNow() : 'Never';
}

export function fullName(u: { firstName: string; lastName: string } | null | undefined): string {
  return u ? `${u.firstName} ${u.lastName}`.trim() : 'Unknown user';
}

export function initials(u: { firstName: string; lastName: string } | null | undefined): string {
  return u ? `${u.firstName[0] ?? ''}${u.lastName[0] ?? ''}`.toUpperCase() : '?';
}

/** "organization_units.assign" → "Organization units · assign". */
export function humanize(code: string): string {
  const text = code.replace(/[._]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Short browser/OS description from a user agent, for session lists. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
