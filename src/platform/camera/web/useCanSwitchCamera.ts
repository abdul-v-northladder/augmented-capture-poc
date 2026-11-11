import { useEffect, useState } from 'react';

/** True only when the browser reports more than one video input (e.g. a phone browser). */
export function useCanSwitchCamera(): boolean {
  const [can, setCan] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        if (!cancelled) setCan(devices.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return can;
}
