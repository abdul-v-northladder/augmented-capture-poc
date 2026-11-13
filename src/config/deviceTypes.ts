import type { DeviceTypeConfig, DeviceTypeId } from '@/types/device';

/**
 * The only place capture-frame dimensions live. Each device type owns an independent frame; ratios are
 * relative to the preview area (see FrameConfiguration), so they scale across screen sizes.
 */
export const DEVICE_TYPES: readonly DeviceTypeConfig[] = [
  {
    id: 'smartphone',
    label: 'Smartphone',
    frame: {
      id: 'smartphone',
      shape: 'rounded-rectangle',
      widthRatio: 0.7,
      heightRatio: 0.9,
      cornerRadius: 6,
      orientation: 'portrait',
    },
  },
  {
    id: 'tablet',
    label: 'Tablet',
    // Landscape frame, wider than tall (~4:3). Ratios are authored for portrait and swapped for landscape:
    // width = heightRatio × preview width, height = widthRatio × preview height.
    frame: {
      id: 'tablet',
      shape: 'rounded-rectangle',
      widthRatio: 0.8,
      heightRatio: 0.75,
      cornerRadius: 16,
      orientation: 'portrait',
    },
  },
];

export const DEFAULT_DEVICE_TYPE_ID: DeviceTypeId = 'smartphone';

export function getDeviceType(id: DeviceTypeId): DeviceTypeConfig {
  return DEVICE_TYPES.find((d) => d.id === id) ?? DEVICE_TYPES[0];
}
