import { Asset } from 'expo-asset';

import { ModelLoadError } from '../types/errors';

/**
 * The bundled model. The file is git-ignored: `npm run ml:setup` copies it from ml/models/ into assets/models/.
 * (If the file is missing, Metro fails with "Unable to resolve module ../../../assets/models/yolo26n.onnx".)
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YOLO26N_MODULE: number = require('../../../assets/models/yolo26n.onnx');

/** `file://` path on native (asset copied to the cache), served URL on web. */
export async function resolveYolo26nUri(): Promise<string> {
  try {
    const asset = Asset.fromModule(YOLO26N_MODULE);
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (!uri) throw new Error('asset has no URI');
    return uri;
  } catch (e) {
    throw new ModelLoadError(`Could not locate the bundled model: ${e instanceof Error ? e.message : String(e)}`, e);
  }
}
