const SAFE_EXTERNAL_HOSTS = new Set(["github.com", "www.github.com"]);

export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeCssImageUrl(value: string | null | undefined): string | null {
  const url = safeHttpsUrl(value);
  if (!url) return null;

  return `url("${url.replace(/\\/g, "%5C").replace(/"/g, "%22")}")`;
}

export function safeGithubUrl(value: string | null | undefined): string | null {
  const url = safeHttpsUrl(value);
  if (!url) return null;

  const parsed = new URL(url);
  return SAFE_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
}
