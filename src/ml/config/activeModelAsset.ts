import { resolveYolo26nUri } from './yolo26nAsset';

/**
 * Where the active model file comes from (`file://` path on native, URL on web). For a fine-tuned model: copy
 * `ml/models/phone-detector.onnx` to assets/models/, add a resolver next to `yolo26nAsset.ts`
 * (`require('../../../assets/models/phone-detector.onnx')` + `Asset.fromModule`), and return it here.
 */
export const resolveActiveModelUri: () => Promise<string> = resolveYolo26nUri;
