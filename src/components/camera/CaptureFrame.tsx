import { useEffect, useMemo, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { FrameConfiguration, FrameGeometry, Size } from '@/types/frame';
import { computeFrameGeometry } from '@/utils/frameGeometry';

type Props = {
  config: FrameConfiguration;
  /** Called whenever the resolved geometry changes (config or preview size). */
  onGeometryChange?: (geometry: FrameGeometry) => void;
};

/**
 * Dimmed overlay with a transparent, outlined cut-out. Fills its parent
 * (the preview area) and never intercepts touches.
 */
export function CaptureFrame({ config, onGeometryChange }: Props) {
  const [size, setSize] = useState<Size | null>(null);

  const geometry = useMemo(() => (size ? computeFrameGeometry(config, size) : null), [config, size]);

  useEffect(() => {
    if (geometry) onGeometryChange?.(geometry);
  }, [geometry, onGeometryChange]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const { width = 0, height = 0 } = size ?? {};
  const borderWidth = config.borderWidth ?? 3;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {geometry && (
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Even-odd: outer rectangle minus the frame path = dim outside, transparent inside. */}
          <Path
            d={`M0 0H${width}V${height}H0Z${geometry.path}`}
            fill={config.overlayColor ?? '#000'}
            fillOpacity={config.overlayOpacity ?? 0.6}
            fillRule="evenodd"
          />
          <Path
            d={geometry.path}
            fill="none"
            stroke={config.borderColor ?? '#fff'}
            strokeWidth={borderWidth}
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </View>
  );
}
