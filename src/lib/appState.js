const STORAGE_KEY = 'piwake.app-state.v1';

export function loadAppState(fallbackDevices) {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || stored.version !== 1 || !Array.isArray(stored.devices)) throw new Error('Invalid state');
    return {
      devices: stored.devices,
      selectedId: stored.devices.some(device => device.id === stored.selectedId) ? stored.selectedId : stored.devices[0]?.id,
    };
  } catch {
    return { devices: fallbackDevices, selectedId: fallbackDevices[0]?.id };
  }
}

export function saveAppState({ devices, selectedId }) {
  const serializableDevices = devices.map(({ icon: _icon, ...device }) => device);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, devices: serializableDevices, selectedId })); }
  catch { /* Private browsing or quota limits should not break controls. */ }
}

export function resetAppState() {
  localStorage.removeItem(STORAGE_KEY);
}
