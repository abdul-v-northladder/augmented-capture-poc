import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  onCapture: () => void;
  onSwitch?: () => void;
  disabled?: boolean;
  /** Extra reason to disable only the shutter (e.g. phone not aligned yet); Flip stays usable. */
  captureDisabled?: boolean;
  /** Shows a spinner in place of the shutter while the photo is being taken and processed. */
  busy?: boolean;
};

export function CameraControls({ onCapture, onSwitch, disabled, captureDisabled, busy }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.side} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take photo"
        disabled={disabled || captureDisabled}
        onPress={onCapture}
        style={({ pressed }) => [styles.shutterOuter, (pressed || (disabled && !busy) || captureDisabled) && styles.dim]}>
        {busy ? <ActivityIndicator size="large" color="#fff" /> : <View style={styles.shutterInner} />}
      </Pressable>
      <View style={styles.side}>
        {onSwitch && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
            disabled={disabled}
            onPress={onSwitch}
            style={({ pressed }) => [styles.switchButton, (pressed || disabled) && styles.dim]}>
            <Text style={styles.switchText}>Flip</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  side: { width: 72, alignItems: 'center' },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  switchButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  switchText: { color: '#fff', fontWeight: '600' },
  dim: { opacity: 0.5 },
});
