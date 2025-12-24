type CountryCache = { country: string; ts: number };

const CACHE_KEY = "spotiflac-country-cache";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FALLBACK_COUNTRY = "US";

function isISO2(country: string): boolean {
  return /^[A-Z]{2}$/.test(country);
}

export function countryFromLocale(locale?: string): string | null {
  if (!locale) return null;

  // Examples: "en-US", "en_US", "en-US-u-ca-gregory"
  const cleaned = locale.replace("_", "-");
  const parts = cleaned.split("-");

  for (const part of parts) {
    if (part.length === 2 && /^[A-Za-z]{2}$/.test(part)) {
      const cc = part.toUpperCase();
      return isISO2(cc) ? cc : null;
    }
  }

  return null;
}

function getCachedCountry(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CountryCache;
    if (!parsed?.country || !parsed?.ts) return null;
    if (Date.now() - parsed.ts > CACHE_MAX_AGE_MS) return null;
    return isISO2(parsed.country) ? parsed.country : null;
  } catch {
    return null;
  }
}

function setCachedCountry(country: string) {
  try {
    const value: CountryCache = { country, ts: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // ignore
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function countryFromIP(): Promise<string | null> {
  // Provider 1: ipapi.co (no key for light use; rate-limited)
  const ipapi = await fetchWithTimeout("https://ipapi.co/json/", 2500);
  const cc1 = (ipapi?.country_code as string | undefined)?.toUpperCase();
  if (cc1 && isISO2(cc1)) return cc1;

  // Provider 2: ipinfo.io (no key for light use; rate-limited)
  const ipinfo = await fetchWithTimeout("https://ipinfo.io/json", 2500);
  const cc2 = (ipinfo?.country as string | undefined)?.toUpperCase();
  if (cc2 && isISO2(cc2)) return cc2;

  return null;
}

export async function getAutoCountryCode(): Promise<string> {
  const cached = getCachedCountry();
  if (cached) return cached;

  const locale =
    Intl.DateTimeFormat().resolvedOptions().locale ||
    navigator.language ||
    (navigator.languages && navigator.languages[0]);

  const fromLocale = countryFromLocale(locale);
  if (fromLocale) {
    setCachedCountry(fromLocale);
    return fromLocale;
  }

  const fromIP = await countryFromIP();
  if (fromIP) {
    setCachedCountry(fromIP);
    return fromIP;
  }

  return FALLBACK_COUNTRY;
}
