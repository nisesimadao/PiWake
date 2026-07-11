const apiBaseUrl = (import.meta.env.VITE_PIWAKE_API_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`PiWake API returned ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export const runtime = {
  mode: apiBaseUrl ? 'api' : 'demo',
  label: apiBaseUrl ? 'PiWake API' : 'Demo adapter',
  apiBaseUrl: apiBaseUrl || null,
};

export const piwakeClient = {
  async wakeDevice(device) {
    if (!apiBaseUrl) return { jobId: `demo-${Date.now()}`, deviceId: device.id };
    return request(`/api/devices/${encodeURIComponent(device.id)}/wake`, { method: 'POST' });
  },
  async addDevice(device) {
    if (!apiBaseUrl) return device;
    return request('/api/devices', { method: 'POST', body: JSON.stringify(device) });
  },
  async checkHealth() {
    if (!apiBaseUrl) return { ok: true, mode: 'demo' };
    return request('/api/health');
  },
};
