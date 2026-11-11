import type { YoloModelConfig } from '../types/model';
import { COCO_CLASS_NAMES } from './cocoClasses';

/** Matches ml/models/yolo26n.onnx: input `images` [1,3,640,640] float32 RGB 0–1, letterboxed with 114. */
export const YOLO26N_CONFIG: YoloModelConfig = {
  id: 'yolo26n',
  inputSize: 640,
  padValue: 114,
  classNames: COCO_CLASS_NAMES,
  targetClassName: 'cell phone',
};
