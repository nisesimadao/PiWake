// Production builds default to the same-origin API (the Pi serves both the UI
// and /api/*). Demo mode is only active in `npm run dev` without an API URL,
// or when explicitly requested via VITE_PIWAKE_MODE=demo.
const configured = (import.meta.env.VITE_PIWAKE_API_URL || '').trim().replace(/\/$/, '');
const demoMode = import.meta.env.VITE_PIWAKE_MODE === 'demo' || (import.meta.env.DEV && !configured);
const apiBaseUrl = configured; // '' = same origin
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
  mode: demoMode ? 'demo' : 'api',
  label: demoMode ? 'Demo adapter' : 'PiWake API',
  apiBaseUrl: demoMode ? null : (apiBaseUrl || 'same-origin'),
};

export function eventsUrl() {
  if (demoMode) return null;
  const token = getApiToken();
  return `${apiBaseUrl}/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export const piwakeClient = {
  async checkHealth() {
    if (demoMode) return { ok: true, mode: 'demo' };
    return request('/api/health');
  },
  async getHost() {
    if (demoMode) return null;
    return request('/api/host');
  },
  async listDevices() {
    if (demoMode) return null;
    return request('/api/devices');
  },
  async addDevice(device) {
    if (demoMode) return device;
    return request('/api/devices', { method: 'POST', body: JSON.stringify(device) });
  },
  async removeDevice(deviceId) {
    if (demoMode) return null;
    return request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  },
  async updateDevice(deviceId, patch) {
    if (demoMode) return patch;
    return request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async getServices(deviceId) {
    if (demoMode) return null;
    return request(`/api/devices/${encodeURIComponent(deviceId)}/services`);
  },
  async listSchedules() {
    if (demoMode) return [];
    return request('/api/schedules');
  },
  async addSchedule(payload) {
    if (demoMode) return null;
    return request('/api/schedules', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateSchedule(scheduleId, patch) {
    if (demoMode) return null;
    return request(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async removeSchedule(scheduleId) {
    if (demoMode) return null;
    return request(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
  },
  async wakeDevice(device) {
    if (demoMode) return { jobId: null, deviceId: device.id };
    return request(`/api/devices/${encodeURIComponent(device.id)}/wake`, { method: 'POST' });
  },
  async getWakeJob(jobId) {
    if (demoMode) return null;
    return request(`/api/jobs/${encodeURIComponent(jobId)}`);
  },
  async cancelWakeJob(jobId) {
    if (demoMode || !jobId) return null;
    return request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  },
  async shutdownDevice(deviceId) {
    if (demoMode) return { sent: true, demo: true };
    return request(`/api/devices/${encodeURIComponent(deviceId)}/shutdown`, { method: 'POST' });
  },
  async shutdownHost() {
    if (demoMode) return { sent: true, demo: true };
    return request('/api/host/shutdown', { method: 'POST' });
  },
  async getActivity() {
    if (demoMode) return null;
    return request('/api/activity');
  },
  async scanNetwork() {
    if (demoMode) return null;
    return request('/api/scan');
  },
};
