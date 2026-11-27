export const COUNTRY_CODES = ['AZ', 'TR', 'RU', 'GE', 'AM', 'KZ', 'UZ', 'UA', 'BY', 'GB', 'US', 'CA', 'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'SE', 'NO', 'FI', 'CH', 'AT', 'CZ', 'IL', 'IR', 'AE', 'SA', 'EG', 'IN', 'CN', 'JP', 'KR', 'TW', 'SG', 'AU', 'BR', 'AR', 'MX'];
export const flag = (code: string | null | undefined) =>
  code && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
export const countryName = (code: string, lang: string) => {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; }
};
