/** URL checks shared by the web and desktop openers. */

/** Whether `url` is an absolute `http:` or `https:` URL: the only kind the openers open. */
export function isWebUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
