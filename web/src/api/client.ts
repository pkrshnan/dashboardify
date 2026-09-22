export const mutationHeaders = {
  'Content-Type': 'application/json',
  'X-Dashboardify-Request': 'dashboard-ui',
};

export class APIError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function responseJSON<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as T | { error?: string } | null;
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
      ? value.error
      : 'Dashboardify could not complete the request';
    throw new APIError(message, response.status);
  }
  return value as T;
}
