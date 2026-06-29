const SAFE_EXTERNAL_HOSTS = new Set(["github.com", "www.github.com"]);
const SAFE_DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

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

export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  if (SAFE_DATA_IMAGE_PATTERN.test(trimmed)) {
    return trimmed.replace(/\s/g, "");
  }

  return safeHttpsUrl(trimmed);
}

export function safeOutputCssImageUrl(value: string | null | undefined): string | null {
  const url = safeImageUrl(value);
  if (!url) return null;

  return `url("${url.replace(/\\/g, "%5C").replace(/"/g, "%22")}")`;
}

export function safeGithubUrl(value: string | null | undefined): string | null {
  const url = safeHttpsUrl(value);
  if (!url) return null;

  const parsed = new URL(url);
  return SAFE_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
}
