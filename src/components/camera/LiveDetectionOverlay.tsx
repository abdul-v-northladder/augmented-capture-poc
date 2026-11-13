import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import { READINESS_MESSAGES } from '@/config/liveDetection';
import type { CaptureReadinessState } from '@/utils/captureReadiness';

/** Banner colour per state: green = good to go, orange = nearly, red = fix the position, dark = neutral. */
const BANNER_COLORS: Record<CaptureReadinessState, string> = {
  searching: 'rgb(252, 252, 252)',
  detected: 'rgb(255, 255, 255)',
  too_far: '#FF453A',
  too_close: '#FF453A',
  outside_frame: '#FF453A',
  aligning: '#FF9F0A',
  ready: '#30D158',
  capturing: '#0A84FF',
};

/**
 * Alignment status banner (the detected phone's box is intentionally not drawn). Subscribes to the engine itself, so only this component
 * re-renders when a detection arrives. The capture frame (SVG) is untouched; this layer uses plain Views.
 */
export function LiveDetectionOverlay({
  engine,
  statsTop,
}: {
  engine: LiveDetectionEngine;
  /** Y (preview px) where the stats line starts, e.g. just below the capture frame. Defaults to the bottom edge. */
  statsTop?: number;
  /** Draw the detected phone's boundary (green when aligned, red otherwise). Off by default on native. */
  showDetectionBox?: boolean;
}) {
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);

  const message =
    s.status === 'error'
      ? 'Live detection unavailable'
      : s.status === 'loading'
        ? 'Loading model…'
        : READINESS_MESSAGES[s.readiness];
  const bannerColor =
    s.status === 'error' ? '#FF9F0A' : s.status === 'loading' ? BANNER_COLORS.searching : BANNER_COLORS[s.readiness];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
   
      <View style={styles.bannerWrap}>
        <Text
          style={[
            styles.banner,
            {
              color: bannerColor,
            },
          ]}
        >
          {message}
        </Text>
        {s.status === 'error' && s.error ? <Text style={styles.debug}>{s.error}</Text> : null}
      </View>
      {/* {s.status === 'running' && (
        <View style={[styles.statsWrap, statsTop === undefined ? { bottom: 12 } : { top: statsTop + 8 }]}>
          <Text style={styles.debug}>
            {s.inferenceMs.toFixed(0)} ms · {s.fps.toFixed(1)} fps
            {s.source ? ` · frame ${s.source.width}×${s.source.height} rot ${s.source.rotation}°` : ''}
          </Text>
          <Text style={styles.debug}>
            phone {s.phone ? s.phone.confidence.toFixed(2) : '–'}
            {s.others.length ? ` · also ${s.others.map((o) => `${o.className} ${o.confidence.toFixed(2)}`).join(', ')}` : ''}
          </Text>
          <Text style={styles.debug}>
            {s.readiness} · {s.alignment.valid ? 'ok' : s.alignment.reasons.join(',')}
            {s.alignment.metrics
              ? ` · fill ${s.alignment.metrics.fillRatio.toFixed(2)} off ${s.alignment.metrics.centerOffsetX.toFixed(2)}/${s.alignment.metrics.centerOffsetY.toFixed(2)}`
              : ''}
          </Text>
        </View>
      )} */}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 3, borderRadius: 4 },
  tag: { position: 'absolute', top: -22, left: -3, color: '#000', fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2 },
  bannerWrap: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    alignItems: 'center',
    gap: 4,
  },
  banner: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 3,
    overflow: 'hidden',
    textAlign: 'center',
  },
  statsWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
  },
  debug: {
    color: '#fff',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
