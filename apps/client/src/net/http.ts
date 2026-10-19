/** Transport failure (network error, non-2xx status, invalid JSON): Flex's FaultEvent. */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

export type Transport = (url: string, body: unknown[]) => Promise<unknown>;

export const postJson: Transport = async (url, body) => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new NetworkError((err as Error).message);
  }
  if (!res.ok) throw new NetworkError(`${url}: HTTP ${res.status}`);
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new NetworkError(`${url}: invalid JSON`);
  }
};
