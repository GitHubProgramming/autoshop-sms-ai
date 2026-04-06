/**
 * Wrapper around fetch() that adds an AbortSignal timeout.
 * Prevents worker threads from blocking forever on hanging external API calls.
 *
 * @param url - The URL to fetch
 * @param options - Standard RequestInit options (do NOT include signal — it will be set here)
 * @param timeoutMs - Timeout in milliseconds (default: 15000)
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...options, signal });
}
