export const marketplaceUnavailableEvent = 'markethub:service-unavailable'

export async function marketplaceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(input, init)
    if (response.status >= 500) window.dispatchEvent(new Event(marketplaceUnavailableEvent))
    return response
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      window.dispatchEvent(new Event(marketplaceUnavailableEvent))
    }
    throw error
  }
}