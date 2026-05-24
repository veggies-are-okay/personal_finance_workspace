/**
 * Tiny HTTP helper around the built-in `fetch` (undici) so parity tests can
 * compare status, content-type, and parsed JSON body of two responses.
 */

export interface CapturedResponse {
  status: number;
  contentType: string | null;
  /** parsed JSON body (tests assert on this) */
  json: unknown;
  /** raw response text (for byte-level comparisons if ever needed) */
  text: string;
}

/** GET a URL and capture the bits parity tests care about. */
export async function getJson(url: string): Promise<CapturedResponse> {
  const res = await fetch(url);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    json,
    text,
  };
}

/** True if a Content-Type header denotes JSON (charset suffix tolerated). */
export function isJsonContentType(contentType: string | null): boolean {
  return (
    contentType !== null &&
    contentType.toLowerCase().includes("application/json")
  );
}
