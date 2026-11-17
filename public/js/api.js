export async function api(path, options = {}) {
  const { method = 'GET', body, headers = {} } = options;
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };

  if (body instanceof Blob) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error('Cannot reach the LumiSafe server. Is it still running?');
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && payload.error
        ? payload.error
        : `Request failed (${response.status}). Please try again.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

export const uploadImage = (file) =>
  api('/api/media', {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': file.type },
  });
