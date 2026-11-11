import { useState } from 'react';

import { DEFAULT_DEVICE_TYPE_ID, DEVICE_TYPES, getDeviceType } from '@/config/deviceTypes';
import type { DeviceTypeId } from '@/types/device';

/** Selected device type. Pure UI state: switching it only changes which `frame` is handed to the camera screen. */
export function useDeviceType(initial: DeviceTypeId = DEFAULT_DEVICE_TYPE_ID) {
  const [selectedId, select] = useState<DeviceTypeId>(initial);
  return { deviceType: getDeviceType(selectedId), deviceTypes: DEVICE_TYPES, selectedId, select };
}
