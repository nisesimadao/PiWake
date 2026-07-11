import React from 'react';
import { faWindows, faApple, faLinux, faRaspberryPi } from '@fortawesome/free-brands-svg-icons';

// Unified brand set: Font Awesome Free Brands (CC BY 4.0 — attribution in LICENSE of the package).
const ICONS = {
  windows: faWindows,
  macos: faApple,
  linux: faLinux,
  raspberrypi: faRaspberryPi,
};

export const OS_OPTIONS = [
  { id: 'windows', label: 'Windows' },
  { id: 'macos', label: 'macOS' },
  { id: 'linux', label: 'Linux' },
  { id: 'raspberrypi', label: 'Raspberry Pi' },
];

export function OsIcon({ os, size = 24, ...props }) {
  const definition = ICONS[os];
  if (!definition) return null;
  const [width, height, , , path] = definition.icon;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${width} ${height}`} fill="currentColor" aria-hidden="true" {...props}>
      {(Array.isArray(path) ? path : [path]).map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
