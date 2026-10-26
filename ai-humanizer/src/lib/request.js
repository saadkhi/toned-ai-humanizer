/** JSON requests with bounded waits and cancellation. Credentials stay on the server. */
export async function requestJson(url, { timeoutMs = 245000, signal, allowUnavailable = false, ...options } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('The rewriting service returned an unreadable response. Please try again.');
    }
    if (!response.ok && !(allowUnavailable && response.status === 503)) {
      const message = typeof data.error === 'string' ? data.error : `The rewriting service could not complete this request (${response.status}).`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (timedOut) throw new Error('This step took too long. Your original text is safe; please try again.');
    if (signal?.aborted) throw new DOMException('Rewrite stopped. Your original text is unchanged.', 'AbortError');
    if (error instanceof TypeError) throw new Error('Could not reach the rewriting service. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
