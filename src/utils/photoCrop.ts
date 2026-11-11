import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { CapturedPhoto } from '@/types/camera';
import type { FrameGeometry, Size } from '@/types/frame';

export type CropRect = { originX: number; originY: number; width: number; height: number };

/**
 * Pixel rectangle of the photo that lies inside the capture frame as the user saw it.
 *
 * The preview shows the photo with "cover" scaling (scaled to fill the view, overflow cropped and centred), so the
 * frame (in preview pixels) maps back to photo pixels by undoing that scale and offset.
 * `flipX` is for photos whose pixels are not mirrored while the (selfie) preview is.
 */
export function computePhotoCropRect(
  frameBounds: FrameGeometry['bounds'],
  preview: Size,
  photo: Size,
  flipX = false,
): CropRect {
  const scale = Math.max(preview.width / photo.width, preview.height / photo.height);
  const offsetX = (photo.width * scale - preview.width) / 2;
  const offsetY = (photo.height * scale - preview.height) / 2;

  let x = (frameBounds.x + offsetX) / scale;
  const y = (frameBounds.y + offsetY) / scale;
  const w = frameBounds.width / scale;
  const h = frameBounds.height / scale;
  if (flipX) x = photo.width - x - w;

  const originX = Math.min(Math.max(0, Math.round(x)), photo.width - 1);
  const originY = Math.min(Math.max(0, Math.round(y)), photo.height - 1);
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(Math.round(w), photo.width - originX)),
    height: Math.max(1, Math.min(Math.round(h), photo.height - originY)),
  };
}

/**
 * Crop a captured photo to what was inside the capture frame in the live preview.
 *
 * Camera sensors store pixels sideways (EXIF carries the rotation) and the image library does not apply it, so
 * the decoded size is measured first. The preview is the truth for "upright": if the decoded shape differs from
 * the preview's (portrait vs landscape), the pixels are rotated upright before cropping — 90° clockwise for the
 * back camera, 270° for the front camera (the sensor orientation of virtually all phones). VisionCamera's
 * `photo.orientation` on Android describes the UI rotation, not the stored pixels, so it is not used.
 */
export async function cropPhotoToFrame(
  photo: CapturedPhoto,
  geometry: FrameGeometry,
  facing: 'front' | 'back',
): Promise<CapturedPhoto> {
  const probe = await ImageManipulator.manipulate(photo.uri).renderAsync();
  const previewPortrait = geometry.previewSize.height >= geometry.previewSize.width;
  const sideways = probe.height >= probe.width !== previewPortrait;
  const rotation = sideways ? (facing === 'front' ? 270 : 90) : 0;
  const size: Size = sideways ? { width: probe.height, height: probe.width } : { width: probe.width, height: probe.height };

  const flipX = facing === 'front' && photo.isMirrored === false;
  const rect = computePhotoCropRect(geometry.bounds, geometry.previewSize, size, flipX);
  if (__DEV__) {
    console.log('[photoCrop]', { reported: [photo.width, photo.height], decoded: [probe.width, probe.height], rotation, preview: geometry.previewSize, frame: geometry.bounds, rect });
  }

  const ctx = ImageManipulator.manipulate(photo.uri);
  if (rotation) ctx.rotate(rotation);
  ctx.crop(rect);
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
