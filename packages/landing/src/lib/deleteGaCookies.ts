export function deleteGaCookies(): void {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  const domains = [''];
  if (parts.length >= 2) {
    domains.push('.' + parts.slice(-2).join('.'));
  }

  document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0]?.trim() ?? '';
    if (name.startsWith('_ga')) {
      for (const domain of domains) {
        const domainAttr = domain ? `; domain=${domain}` : '';
        document.cookie = `${name}=; max-age=0; path=/${domainAttr}`;
      }
    }
  });
}
