import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = { url: 'piwake.api-url.v1', token: 'piwake.api-token.v1' };

const config = { url: '', token: '' };

export async function loadConfig() {
  try {
    const [url, token] = await Promise.all([
      AsyncStorage.getItem(KEYS.url),
      AsyncStorage.getItem(KEYS.token),
    ]);
    config.url = (url || '').trim().replace(/\/+$/, '');
    config.token = (token || '').trim();
  } catch { /* first launch */ }
  return { ...config };
}

export async function saveConfig({ url, token }) {
  config.url = (url || '').trim().replace(/\/+$/, '');
  config.token = (token || '').trim();
  try {
    await Promise.all([
      AsyncStorage.setItem(KEYS.url, config.url),
      AsyncStorage.setItem(KEYS.token, config.token),
    ]);
  } catch { /* storage full — keep in-memory config */ }
  return { ...config };
}

export function getConfig() {
  return { ...config };
}

export function isDemo() {
  return !config.url;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(`${config.url}${path}`, { ...options, headers, signal: controller.signal });
  } catch (cause) {
    const error = new Error('PiWake APIに接続できません');
    error.network = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error || ''; } catch { /* non-JSON body */ }
    const error = new Error(detail || `PiWake API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

export const piwakeClient = {
  async checkHealth() {
    if (isDemo()) return { ok: true, mode: 'demo' };
    return request('/api/health');
  },
  async getHost() {
    if (isDemo()) return null;
    return request('/api/host');
  },
  async listDevices() {
    if (isDemo()) return null;
    return request('/api/devices');
  },
  async addDevice(device) {
    if (isDemo()) return device;
    return request('/api/devices', { method: 'POST', body: JSON.stringify(device) });
  },
  async removeDevice(deviceId) {
    if (isDemo()) return null;
    return request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  },
  async updateDevice(deviceId, patch) {
    if (isDemo()) return patch;
    return request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async getServices(deviceId) {
    if (isDemo()) return null;
    return request(`/api/devices/${encodeURIComponent(deviceId)}/services`);
  },
  async wakeDevice(device) {
    if (isDemo()) return { jobId: null, deviceId: device.id };
    return request(`/api/devices/${encodeURIComponent(device.id)}/wake`, { method: 'POST' });
  },
  async getWakeJob(jobId) {
    if (isDemo()) return null;
    return request(`/api/jobs/${encodeURIComponent(jobId)}`);
  },
  async cancelWakeJob(jobId) {
    if (isDemo() || !jobId) return null;
    return request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  },
  async shutdownDevice(deviceId) {
    if (isDemo()) return { sent: true, demo: true };
    return request(`/api/devices/${encodeURIComponent(deviceId)}/shutdown`, { method: 'POST' });
  },
  async shutdownHost() {
    if (isDemo()) return { sent: true, demo: true };
    return request('/api/host/shutdown', { method: 'POST' });
  },
  async listSchedules() {
    if (isDemo()) return [];
    return request('/api/schedules');
  },
  async addSchedule(payload) {
    if (isDemo()) return null;
    return request('/api/schedules', { method: 'POST', body: JSON.stringify(payload) });
  },
  async updateSchedule(scheduleId, patch) {
    if (isDemo()) return null;
    return request(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  },
  async removeSchedule(scheduleId) {
    if (isDemo()) return null;
    return request(`/api/schedules/${encodeURIComponent(scheduleId)}`, { method: 'DELETE' });
  },
  async getActivity() {
    if (isDemo()) return null;
    return request('/api/activity');
  },
  async scanNetwork() {
    if (isDemo()) return null;
    return request('/api/scan');
  },
};
