import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'fast-png';
import { Platform } from 'react-native';

import { laplacianVariance, toGray } from './laplacian';

/** Photos are compared at this width so scores don't depend on camera resolution. */
const ANALYSIS_WIDTH = 320;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Sharpness score of a photo (higher = sharper). Returns `Infinity` where it can't be measured (web), so callers
 * treat the photo as acceptable.
 */
export async function measureSharpness(uri: string): Promise<number> {
  if (Platform.OS === 'web') return Infinity;
  try {
    const small = await ImageManipulator.manipulate(uri).resize({ width: ANALYSIS_WIDTH }).renderAsync();
    const saved = await small.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!saved.base64) return Infinity;
    const png = decode(base64ToBytes(saved.base64));
    if (png.depth !== 8) return Infinity;
    return laplacianVariance(toGray(png.data, png.width, png.height, png.channels), png.width, png.height);
  } catch (e) {
    if (__DEV__) console.warn('[blur] could not measure sharpness', e);
    return Infinity; // never block a capture because the check itself failed
  }
}
