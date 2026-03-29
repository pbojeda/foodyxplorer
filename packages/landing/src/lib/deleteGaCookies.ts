export function deleteGaCookies(): void {
  document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0]?.trim() ?? '';
    if (name.startsWith('_ga')) {
      document.cookie = `${name}=; max-age=0; path=/`;
    }
  });
}
