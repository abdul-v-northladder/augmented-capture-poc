export class MlError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
/** The model asset or the runtime could not be loaded. */
export class ModelLoadError extends MlError {}
/** The image could not be read or decoded. */
export class ImageLoadError extends MlError {}
/** The session failed while running, or produced an unusable output. */
export class InferenceError extends MlError {}
