export async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  let body = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch (error) {
      throw new Error(`${options.method || "GET"} ${url} returned non-JSON response: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }

  return {
    body,
    headers: response.headers,
    status: response.status,
  };
}
