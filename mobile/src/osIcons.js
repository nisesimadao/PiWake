import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { faWindows, faApple, faLinux, faRaspberryPi } from '@fortawesome/free-brands-svg-icons';

// Unified brand set: Font Awesome Free Brands — same source as the web console.
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

export function OsIcon({ os, size = 24, color = '#a8b0bc' }) {
  const definition = ICONS[os];
  if (!definition) return null;
  const [width, height, , , path] = definition.icon;
  const paths = Array.isArray(path) ? path : [path];
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${width} ${height}`}>
      {paths.map((d, i) => <Path key={i} d={d} fill={color} />)}
    </Svg>
  );
}
