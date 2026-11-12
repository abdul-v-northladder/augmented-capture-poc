import type { LiveDetectionEngine } from '@/ml/live/LiveDetectionEngine';

export type CameraFacing = 'front' | 'back';

/** Lifecycle of the live preview (after permission has been granted). */
export type CameraStatus = 'loading' | 'ready' | 'error';

export type CameraPermissionStatus = 'loading' | 'undetermined' | 'granted' | 'denied';

export type CameraPermission = {
  status: CameraPermissionStatus;
  /** false when the OS/browser will no longer show a prompt (user must change settings). */
  canAskAgain: boolean;
  request: () => Promise<void>;
};

export type CapturedPhoto = {
  /** file:// URI on native, data: URL on web. */
  uri: string;
  width: number;
  height: number;
  /** Whether the pixels are mirrored like a selfie preview (front camera). Unknown when omitted. */
  isMirrored?: boolean;
  /** Native: how the stored pixels are rotated relative to upright (EXIF-style), when not already applied. */
  orientation?: 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';
};

/** Imperative handle exposed by every platform preview implementation. */
export type CameraHandle = {
  takePhoto: () => Promise<CapturedPhoto>;
  /** Focus (and meter exposure) on a point in preview coordinates. Optional: web has no such control. */
  focus?: (point: { x: number; y: number }) => Promise<void>;
};

/** Contract implemented by `platform/camera/mobile` and `platform/camera/web`. */
export type PlatformCameraPreviewProps = {
  facing: CameraFacing;
  onReady: () => void;
  onError: (message: string) => void;
  /** When set (native only), camera frames are fed to this engine for live detection. */
  liveEngine?: LiveDetectionEngine;
  ref?: React.Ref<CameraHandle>;
};
