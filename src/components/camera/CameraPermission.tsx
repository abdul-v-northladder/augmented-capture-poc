import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CameraPermission as Permission } from '@/types/camera';

/** Shown for the "undetermined" and "denied" permission states. */
export function CameraPermission({ permission }: { permission: Permission }) {
  const denied = permission.status === 'denied';
  const canOpenSettings = denied && Platform.OS !== 'web';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{denied ? 'Camera access denied' : 'Camera access needed'}</Text>
      <Text style={styles.body}>
        {!denied
          ? 'Allow camera access to show the live preview and take photos.'
          : Platform.OS === 'web'
            ? 'Camera access is blocked. Allow it from the lock icon in the address bar, then try again.'
            : 'Enable camera access for this app in system settings, then come back.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        onPress={() => {
          if (canOpenSettings && !permission.canAskAgain) Linking.openSettings();
          else permission.request();
        }}>
        <Text style={styles.buttonText}>
          {canOpenSettings && !permission.canAskAgain
            ? 'Open settings'
            : denied
              ? 'Try again'
              : 'Allow camera'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { color: '#bbb', fontSize: 15, textAlign: 'center', maxWidth: 360 },
  button: { backgroundColor: '#208AEF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
