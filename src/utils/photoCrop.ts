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

/** Extra background kept around the phone, as a fraction of the phone's own width / height. */
export const PHONE_TRIM_PADDING = 0.01;

/**
 * Pixel rect for a normalised (0–1) detection box grown by `padding` (fraction of the box size) on every side,
 * clamped to the photo.
 */
export function computePhoneTrimRect(
  box: { x: number; y: number; width: number; height: number },
  photo: Size,
  padding = PHONE_TRIM_PADDING,
): CropRect {
  const padX = box.width * padding;
  const padY = box.height * padding;
  const x0 = Math.max(0, Math.floor((box.x - padX) * photo.width));
  const y0 = Math.max(0, Math.floor((box.y - padY) * photo.height));
  const x1 = Math.min(photo.width, Math.ceil((box.x + box.width + padX) * photo.width));
  const y1 = Math.min(photo.height, Math.ceil((box.y + box.height + padY) * photo.height));
  return { originX: x0, originY: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/**
 * Tighten an (already frame-cropped, upright) photo to the detected phone plus a little padding, so the result is
 * the phone edge to edge. Falls back to the input photo if no phone is found or detection fails.
 */
export async function trimPhotoToPhone(photo: CapturedPhoto): Promise<CapturedPhoto> {
  try {
    // Lazy: keeps the ML stack out of this module's import graph until a capture happens.
    const { getPhoneDetectionService } = await import('@/ml');
    const { detections } = await getPhoneDetectionService().detect(photo.uri);
    if (detections.length === 0) return photo;
    const best = detections.reduce((a, b) => (b.confidence > a.confidence ? b : a));

    const rect = computePhoneTrimRect(best.boundingBox, { width: photo.width, height: photo.height });
    const ctx = ImageManipulator.manipulate(photo.uri);
    ctx.crop(rect);
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch (e) {
    if (__DEV__) console.warn('[photoCrop] trimPhotoToPhone failed, keeping frame crop', e);
    return photo;
  }
}
