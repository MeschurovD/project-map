type ApiErrorBody = {
  message?: string;
  error?: string;
};

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return readJsonResponse<T>(response);
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJsonResponse<T>(response);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & ApiErrorBody;
  if (!response.ok) throw new Error(body.message ?? body.error ?? "Request failed");
  return body;
}
