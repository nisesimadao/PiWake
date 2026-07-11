const apiBaseUrl = (import.meta.env.VITE_PIWAKE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'piwake.api-token.v1';

export function getApiToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setApiToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* Private browsing should not break settings. */ }
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch { /* non-JSON error body */ }
    const error = new Error(detail || `PiWake API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export const runtime = {
  mode: apiBaseUrl ? 'api' : 'demo',
  label: apiBaseUrl ? 'PiWake API' : 'Demo adapter',
  apiBaseUrl: apiBaseUrl || null,
};

export const piwakeClient = {
  async checkHealth() {
    if (!apiBaseUrl) return { ok: true, mode: 'demo' };
    return request('/api/health');
  },
  async getHost() {
    if (!apiBaseUrl) return null;
    return request('/api/host');
  },
  async listDevices() {
    if (!apiBaseUrl) return null;
    return request('/api/devices');
  },
  async addDevice(device) {
    if (!apiBaseUrl) return device;
    return request('/api/devices', { method: 'POST', body: JSON.stringify(device) });
  },
  async removeDevice(deviceId) {
    if (!apiBaseUrl) return null;
    return request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  },
  async wakeDevice(device) {
    if (!apiBaseUrl) return { jobId: null, deviceId: device.id };
    return request(`/api/devices/${encodeURIComponent(device.id)}/wake`, { method: 'POST' });
  },
  async getWakeJob(jobId) {
    if (!apiBaseUrl) return null;
    return request(`/api/jobs/${encodeURIComponent(jobId)}`);
  },
  async cancelWakeJob(jobId) {
    if (!apiBaseUrl || !jobId) return null;
    return request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  },
  async getActivity() {
    if (!apiBaseUrl) return null;
    return request('/api/activity');
  },
  async scanNetwork() {
    if (!apiBaseUrl) return null;
    return request('/api/scan');
  },
};
