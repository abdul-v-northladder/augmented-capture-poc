import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';
import { READINESS_MESSAGES } from '@/config/liveDetection';
import type { CaptureReadinessState } from '@/utils/captureReadiness';

/** Banner colour per state: green = good to go, orange = nearly, red = fix the position, dark = neutral. */
const BANNER_COLORS: Record<CaptureReadinessState, string> = {
  searching: 'rgba(0,0,0,0.65)',
  detected: 'rgba(0,0,0,0.65)',
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
  showDetectionBox = false,
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
      {showDetectionBox && s.phone && (
        <View
          style={[
            styles.box,
            {
              left: s.phone.box.x,
              top: s.phone.box.y,
              width: s.phone.box.width,
              height: s.phone.box.height,
              borderColor: s.alignment.valid ? '#30D158' : '#FF453A',
            },
          ]}>
          <Text style={[styles.tag, { backgroundColor: s.alignment.valid ? '#30D158' : '#FF453A' }]}>
            {s.phone.className} {(s.phone.confidence * 100).toFixed(0)}%
          </Text>
        </View>
      )}
      <View style={styles.bannerWrap}>
        <Text
          style={[
            styles.banner,
            {
              backgroundColor: bannerColor,
            },
          ]}
        >
          {message}
        </Text>
        {s.status === 'error' && s.error ? <Text style={styles.debug}>{s.error}</Text> : null}
      </View>
      {s.status === 'running' && (
        <View style={[styles.statsWrap, statsTop === undefined ? { bottom: 12 } : { top: statsTop + 8 }]}>
          <Text style={styles.debug}>
            {s.inferenceMs.toFixed(0)} ms · {s.fps.toFixed(1)} fps
            {s.source ? ` · frame ${s.source.width}×${s.source.height} rot ${s.source.rotation}°` : ''}
          </Text>
          {/* Diagnostics: what the model sees besides the phone, and the phone's own score. */}
          <Text style={styles.debug}>
            phone {s.phone ? s.phone.confidence.toFixed(2) : '–'}
            {s.others.length ? ` · also ${s.others.map((o) => `${o.className} ${o.confidence.toFixed(2)}`).join(', ')}` : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderWidth: 3, borderRadius: 4 },
  tag: { position: 'absolute', top: -22, left: -3, color: '#000', fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2 },
  bannerWrap: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    alignItems: 'center',
    gap: 4,
  },
  banner: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
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
