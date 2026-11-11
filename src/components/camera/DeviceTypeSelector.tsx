import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DeviceTypeConfig, DeviceTypeId } from '@/types/device';

type Props = {
  deviceTypes: readonly DeviceTypeConfig[];
  selectedId: DeviceTypeId;
  onSelect: (id: DeviceTypeId) => void;
};

/** Presentational device-type tabs. Knows nothing about frames or the camera. */
export function DeviceTypeSelector({ deviceTypes, selectedId, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {deviceTypes.map((d) => {
        const selected = d.id === selectedId;
        return (
          <Pressable
            key={d.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(d.id)}
            style={[styles.chip, selected && styles.chipSelected]}>
            <Text style={[styles.text, selected && styles.textSelected]}>{d.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#000' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)' },
  chipSelected: { backgroundColor: '#fff' },
  text: { color: '#fff', fontWeight: '600' },
  textSelected: { color: '#000' },
});
