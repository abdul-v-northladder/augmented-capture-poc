import type { FrameConfiguration } from './frame';

export type DeviceTypeId = 'smartphone' | 'tablet';

/** A selectable device type and the capture frame used for it. */
export interface DeviceTypeConfig {
  id: DeviceTypeId;
  label: string;
  frame: FrameConfiguration;
}
