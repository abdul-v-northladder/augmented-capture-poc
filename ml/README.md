# ml/ — pretrained YOLO → ONNX (cell-phone detection)

Independent of the app: nothing under `ml/` is bundled by Metro.
No training, no custom model, no live-camera inference yet.

```
ml/
  models/      yolo26n.onnx, yolo26n-raw.onnx, yolo26n-seg.onnx (+ *.metadata.json)  ← .onnx/.pt are git-ignored
  scripts/     export_model.py · test_model.py · evaluate_segmentation.py
  samples/     phone.jpg (input) · phone_detected_*.jpg · phone_segmented.jpg (outputs)
  requirements.txt
```

## Quick start

```bash
cd ml
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python scripts/export_model.py                 # downloads yolo26n.pt, writes models/yolo26n.onnx (+ .metadata.json)
python scripts/export_model.py --head raw      # optional: classic head -> models/yolo26n-raw.onnx
python scripts/test_model.py                   # ONNX Runtime inference + cell-phone filter + annotated image
python scripts/test_model.py --conf 0.4 --iou 0.5 --show-all
python scripts/export_model.py --model yolo26n-seg.pt && python scripts/evaluate_segmentation.py   # evaluation only
```

`.onnx`/`.pt` are 5–11 MB each and reproducible, so they are ignored (`ml/.gitignore`); the metadata JSONs and sample images are committed.

## Model choice

**YOLO26n** (Ultralytics, nano, COCO-pretrained, 2.41 M parameters, 5.5 GFLOPs, 9.9 MB as ONNX).

- Nano class, trained on COCO, which contains `cell phone` (class 67) — no training needed.
- It can export an **NMS-free, end-to-end head** (`[1, 300, 6]`): no NMS code is needed in JS, which matters for the per-frame budget later.
- I did **not** export or benchmark YOLO11n or other families, so this is a reasoned choice, not a measured bake-off. Third-party sources report YOLO26n ≈ YOLO11n in COCO mAP with faster CPU inference; I did not verify that.

### ⚠ Licence — decide before shipping

The exported ONNX embeds `license: AGPL-3.0` (Ultralytics). AGPL applies to the weights/code lineage; using them in a distributed commercial app can require open-sourcing the app or buying an Ultralytics Enterprise licence. **Get legal/compliance sign-off before this leaves the POC.** If AGPL is unacceptable, alternatives to evaluate (not tested here, licences from memory — verify): YOLOX-Nano (Apache-2.0), other permissively licensed COCO detectors, or a model trained on your own data under your own licence.

## Model specification (verified from the exported graphs)

|                    |                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Input name / shape | `images` / `[1, 3, 640, 640]`, float32, **fixed** (not dynamic)                                           |
| Layout             | NCHW, channels in **RGB** order                                                                           |
| Normalisation      | pixel / 255 → range **0–1**. No mean/std.                                                                 |
| Resize             | **Letterbox**: scale = min(640/w, 640/h), keep aspect ratio, centre, pad with value **114/255** (grey)    |
| Stride / opset     | 32 / ONNX opset 17, IR v10, domain `ai.onnx` only (no custom ops)                                         |
| Classes            | 80 COCO names, embedded in the model (`names` metadata) and in `*.metadata.json`; **`67 = "cell phone"`** |

Look the class up by name (as `test_model.py` does) rather than hard-coding 67.

### Output tensors

Ultralytics' **default** YOLO26 ONNX export is the raw head, _not_ NMS-free. `export_model.py` therefore sets `end2end` explicitly.

**`yolo26n.onnx` — `--head end2end` (default, recommended)** → `output0: [1, 300, 6]`

| col     | 0   | 1   | 2   | 3   | 4           | 5        |
| ------- | --- | --- | --- | --- | ----------- | -------- |
| meaning | x1  | y1  | x2  | y2  | score (0–1) | class id |

Pixels in the 640×640 _letterboxed input_ space; already top-300, already de-duplicated; unused slots have low scores, so just threshold. Undo the letterbox: `x = (x − pad_x)/scale`, `y = (y − pad_y)/scale`.

**`yolo26n-raw.onnx` — `--head raw`** → `output0: [1, 84, 8400]` (channels-first; 8400 = 80²+40²+20² anchors)

rows 0–3 = **cx, cy, w, h** (letterboxed pixels), rows 4–83 = 80 class scores, **already sigmoided (0–1)**. The consumer must pick `max` score per anchor, threshold, and run class-aware NMS. `test_model.py` auto-detects the box encoding from the values (my first guess was wrong, which is why it is not hard-coded) and has `--raw-box-format` to override.

`--conf` applies to both; `--iou` only matters for the raw head (the NMS-free head does not use it).

## Results on `samples/phone.jpg` (1280×960)

|            | end-to-end                           | raw + numpy NMS                      | Ultralytics `.pt` reference          |
| ---------- | ------------------------------------ | ------------------------------------ | ------------------------------------ |
| cell phone | 0.896 `[414.5, 344.3, 843.3, 584.8]` | 0.825 `[414.7, 344.8, 842.3, 583.3]` | 0.899 `[416.7, 346.2, 838.8, 582.4]` |

Also detected (non-phone): dining table, 2× chair. Both heads agree with the reference to ~3 px. ORT Python 1.19.2, CPU (Apple M1), model-only median: **31.8 ms** (end-to-end), 30.7 ms (raw), 47.0 ms (seg). One image only — not an accuracy evaluation.

## Operators & runtime compatibility

Operators in the NMS-free graph: Add, Cast, Concat, Conv, Div, Expand, Flatten, GatherElements, MatMul, MaxPool, Mod, Mul, ReduceMax, Reshape, Resize, Sigmoid, Slice, Softmax, Split, Sub, **TopK**, Transpose, Unsqueeze. The raw graph drops Cast/Expand/Flatten/GatherElements/Mod/ReduceMax/TopK — it is the most conservative option.

| Target                                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python ORT (CPU EP)                      | ✅ run                                                                                                                                                                                                                                                                                                                                                                                                                |
| **ONNX Runtime Web, WASM EP**            | ✅ run in Node (`onnxruntime-web`, 1 thread, ~210 ms): same phone, 0.901                                                                                                                                                                                                                                                                                                                                              |
| ORT Web WebGPU/WebGL                     | ❌ not tested; the WebGL table lists TopK/GatherElements without version ranges, so expect CPU/WASM fallback for those nodes                                                                                                                                                                                                                                                                                          |
| Android/iOS (`onnxruntime-react-native`) | ❌ **not run on device.** `check_onnx_model_mobile_usability`: NNAPI can take 373/384 nodes but in 8 partitions, CoreML MLProgram 363/384 in 8 partitions; both are flagged _"not recommended… use the CPU EP"_. Unsupported by NNAPI: Expand, GatherElements, Mod, ReduceMax, TopK. The docs I could access did not state the operator set of the React Native package, so confirm it on a device in the next phase. |

Practical consequences: run on the **CPU/XNNPACK** provider first; if a runtime rejects TopK/GatherElements, fall back to `yolo26n-raw.onnx` (plain operators) and port the ~30 lines of NMS from `test_model.py`. Do not use `nms=True` exports: they embed NonMaxSuppression/NonZero/ScatterND, the least portable ops. FP16 is not recommended for WASM; INT8 quantisation is untried.

## Detection vs. instance segmentation

I exported `yolo26n-seg` **for evaluation only** — the detector above is unchanged.

- Outputs: `output0 [1,300,38]` (the 6 detection columns + 32 mask coefficients), `output1 [1,32,160,160]` (mask prototypes). Mask = sigmoid(coeffs · prototypes), upsample, crop to box, remove letterbox, threshold 0.5.
- 11.2 MB (+13%), 47 ms vs 32 ms on CPU (+48%), plus mask post-processing. Same operator set plus `ConvTranspose`.
- On the sample the mask hugs the phone: **it covers 54% of the box area** (the box includes a lot of table because the phone is rotated), yields an 8-vertex polygon and a rotated rectangle (158×420 px @ 68°). See `samples/phone_segmented.jpg`.

**Recommendation:** keep **detection** for the real-time loop (cheaper, simpler to port). Use segmentation only if a feature truly needs the outline — e.g. comparing the phone to the capture frame at its true rotation/shape, or checking that the whole device is inside an angular frame. If so, run it on a still/throttled frame (or run detection first, then segmentation on the crop), and validate on more than one image. A box can't tell rotation; the rotated-rect from a mask can.

## Using the model in the app (next phase; snippets are untested sketches)

Shared TypeScript pipeline (identical for both platforms): letterbox to 640×640 RGB → Float32Array `CHW / 255` → `session.run({ images })` → read `[300,6]`, keep `score ≥ conf && cls === 67` → un-letterbox → compare to `FrameGeometry.bounds` from Phase 2.

**React Web — `onnxruntime-web`**

```ts
import * as ort from "onnxruntime-web";
const session = await ort.InferenceSession.create("/models/yolo26n.onnx", {
  executionProviders: ["wasm"],
});
// draw the <video> frame to a 640x640 canvas with letterboxing, then:
const input = new ort.Tensor("float32", chwFloat32, [1, 3, 640, 640]);
const { output0 } = await session.run({ images: input }); // output0.data: Float32Array(300*6)
for (let i = 0; i < 300; i++) {
  const [x1, y1, x2, y2, score, cls] = output0.data.slice(
    i * 6,
    i * 6 + 6,
  ) as unknown as number[];
  if (score >= 0.25 && cls === 67) {
    /* un-letterbox, use */
  }
}
```

Serve the `.onnx` and ORT's `.wasm` files as static assets (web build is `output: "server"`; put them under `public/`).

**React Native (iOS/Android) — `onnxruntime-react-native`**

```ts
import { InferenceSession, Tensor } from "onnxruntime-react-native";
const session = await InferenceSession.create(modelFileUri, {
  executionProviders: ["cpu"],
});
const out = await session.run({
  images: new Tensor("float32", chwFloat32, [1, 3, 640, 640]),
});
```

It is a native module: needs a development build (not Expo Go) and a rebuild after install. The model must be on disk (bundle it as an asset and copy via `expo-asset`/`expo-file-system`, or download at first launch — the .onnx is git-ignored). Getting RGB pixels from the camera is the hard part and is the subject of the real-time phase (that is where VisionCamera frame processors come in).

## Reproducibility

Pinned in `requirements.txt` (Python 3.9.6, ultralytics 8.4.202, onnxruntime 1.19.2). `export_model.py` exports from a scratch copy so the two heads never overwrite each other, runs `onnx.checker`, and records inputs/outputs/opset/operators/class names/SHA-256 in `<model>.metadata.json`.

Sample image: Wikimedia Commons, "Süwex Tisch mit Handy.jpg", licensed CC BY-SA 3.0 (author not captured here — look up the file page before redistributing).
