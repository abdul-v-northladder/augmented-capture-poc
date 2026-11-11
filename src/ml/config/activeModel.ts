import type { YoloModelConfig } from '../types/model';
import { YOLO26N_CONFIG } from './yolo26n';

/**
 * Which model the app runs (static description: input size, padding, class list, target class). Everything that
 * needs the input size or class names (the live engine, both frame pipelines, the detection service) reads this
 * and nothing else. Where the file comes from is the matching `activeModelAsset.ts` (kept separate so tests and
 * pure code never import the bundled .onnx asset).
 *
 * Switching to a fine-tuned detector (see ml/training/README.md): add a config like the stock one, e.g.
 *   const PHONE_DETECTOR_CONFIG: YoloModelConfig = {
 *     id: 'phone-detector', inputSize: 640, padValue: 114,
 *     classNames: ['phone', 'phone_case'], targetClassName: 'phone',
 *   };
 * and point ACTIVE_MODEL_CONFIG at it. `phone_case` then acts as the competing class that suppresses covers.
 */
export const ACTIVE_MODEL_CONFIG: YoloModelConfig = YOLO26N_CONFIG;
