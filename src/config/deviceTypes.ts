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
      widthRatio: 0.55,
      heightRatio: 0.78,
      cornerRadius: 20,
      orientation: 'portrait',
    },
  },
  {
    id: 'flip-phone',
    label: 'Flip Phones',
    // Taller and narrower than the smartphone frame.
    frame: {
      id: 'flip-phone',
      shape: 'rectangle',
      widthRatio: 0.42,
      heightRatio: 0.85,
      cornerRadius: 12,
      orientation: 'portrait',
      borderColor: '#FFD60A',
    },
  },
];

export const DEFAULT_DEVICE_TYPE_ID: DeviceTypeId = 'smartphone';

export function getDeviceType(id: DeviceTypeId): DeviceTypeConfig {
  return DEVICE_TYPES.find((d) => d.id === id) ?? DEVICE_TYPES[0];
}
