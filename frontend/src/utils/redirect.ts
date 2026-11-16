/** Only allows same-site relative paths, so `?redirect=` can't send users elsewhere. */
export function safeRedirect(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
