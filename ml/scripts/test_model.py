#!/usr/bin/env python3
"""Run an exported YOLO ONNX model with ONNX Runtime and report cell-phone detections.

Nothing about the output layout is hard-coded: the script inspects the session's
real input/output tensors, infers the layout from their shapes, and validates the
inferred layout against the values it actually receives.

Examples
    python scripts/test_model.py
    python scripts/test_model.py --conf 0.4 --iou 0.5 --show-all
    python scripts/test_model.py --model models/yolo26n-raw.onnx   # raw head -> numpy NMS is applied
"""
from __future__ import annotations

import argparse
import ast
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont

ML_DIR = Path(__file__).resolve().parents[1]


# --------------------------------------------------------------------------- preprocessing
@dataclass
class Letterbox:
    scale: float
    pad_x: float
    pad_y: float
    src_w: int
    src_h: int


def preprocess(img: Image.Image, size_hw: tuple[int, int]) -> tuple[np.ndarray, Letterbox]:
    """RGB, aspect-preserving resize, grey (114) padding, /255, NCHW float32."""
    th, tw = size_hw
    sw, sh = img.size
    scale = min(tw / sw, th / sh)
    nw, nh = round(sw * scale), round(sh * scale)
    resized = img.resize((nw, nh), Image.BILINEAR)
    canvas = Image.new("RGB", (tw, th), (114, 114, 114))
    pad_x, pad_y = (tw - nw) / 2, (th - nh) / 2
    canvas.paste(resized, (int(round(pad_x - 0.1)), int(round(pad_y - 0.1))))
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    return arr.transpose(2, 0, 1)[None], Letterbox(scale, pad_x, pad_y, sw, sh)


# -------------------------------------------------------------------------- postprocessing
def iou_one_to_many(box: np.ndarray, boxes: np.ndarray) -> np.ndarray:
    x1 = np.maximum(box[0], boxes[:, 0])
    y1 = np.maximum(box[1], boxes[:, 1])
    x2 = np.minimum(box[2], boxes[:, 2])
    y2 = np.minimum(box[3], boxes[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = (box[2] - box[0]) * (box[3] - box[1])
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    return inter / np.maximum(area + areas - inter, 1e-9)


def nms(boxes: np.ndarray, scores: np.ndarray, classes: np.ndarray, iou_thr: float) -> list[int]:
    """Class-aware greedy NMS."""
    keep: list[int] = []
    for c in np.unique(classes):
        idx = np.where(classes == c)[0]
        idx = idx[np.argsort(-scores[idx])]
        while idx.size:
            i = idx[0]
            keep.append(int(i))
            if idx.size == 1:
                break
            idx = idx[1:][iou_one_to_many(boxes[i], boxes[idx[1:]]) <= iou_thr]
    return sorted(keep, key=lambda i: -scores[i])


def infer_layout(shape: list, num_classes: int) -> str:
    """Decide how to decode a rank-3 output from its static shape alone."""
    if len(shape) != 3:
        raise SystemExit(f"Unsupported output rank {len(shape)}: {shape}")
    _, a, b = shape
    if b == 6 and a != 4 + num_classes:
        return "detections"  # [1, max_det, 6] = x1,y1,x2,y2,score,class (already NMS-free)
    if a == 4 + num_classes:
        return "raw_channels_first"  # [1, 4+nc, anchors] = cx,cy,w,h, class scores
    if b == 4 + num_classes:
        return "raw_anchors_first"  # [1, anchors, 4+nc]
    raise SystemExit(f"Cannot infer layout from output shape {shape} with {num_classes} classes")


def decode(output: np.ndarray, layout: str, conf_thr: float, iou_thr: float, raw_box_format: str = "auto"):
    """Returns (boxes_xyxy in network-input pixels, scores, class_ids)."""
    out = output[0]
    if layout == "detections":
        boxes, scores, cls = out[:, :4], out[:, 4], out[:, 5].astype(int)
        # sanity checks that prove the layout guess is right for *these* values
        assert np.all((scores >= 0) & (scores <= 1)), "column 4 is not a probability"
        assert np.allclose(out[:, 5], np.round(out[:, 5])), "column 5 is not a class index"
        m = scores >= conf_thr
        return boxes[m], scores[m], cls[m]

    pred = out if layout == "raw_channels_first" else out.T  # -> [4+nc, anchors]
    pred = pred.T  # -> [anchors, 4+nc]
    box_cols, cls_scores = pred[:, :4], pred[:, 4:]
    if cls_scores.min() < -1e-4 or cls_scores.max() > 1 + 1e-4:
        raise SystemExit("Class scores are outside [0,1]; model outputs logits, apply sigmoid first.")
    if raw_box_format == "auto":
        # If x2>=x1 and y2>=y1 for every anchor the 4 columns are corners; centre/size would
        # almost never satisfy that (a width is not generally larger than the centre x).
        corners = bool(np.all(box_cols[:, 2] >= box_cols[:, 0]) and np.all(box_cols[:, 3] >= box_cols[:, 1]))
        raw_box_format = "xyxy" if corners else "xywh"
        print(f"raw box format auto-detected: {raw_box_format}")
    scores = cls_scores.max(1)
    cls = cls_scores.argmax(1)
    m = scores >= conf_thr
    box_cols, scores, cls = box_cols[m], scores[m], cls[m]
    if raw_box_format == "xyxy":
        boxes = box_cols.copy()
    else:
        boxes = np.empty_like(box_cols)
        boxes[:, 0] = box_cols[:, 0] - box_cols[:, 2] / 2
        boxes[:, 1] = box_cols[:, 1] - box_cols[:, 3] / 2
        boxes[:, 2] = box_cols[:, 0] + box_cols[:, 2] / 2
        boxes[:, 3] = box_cols[:, 1] + box_cols[:, 3] / 2
    keep = nms(boxes, scores, cls, iou_thr)
    return boxes[keep], scores[keep], cls[keep]


def to_image_coords(boxes: np.ndarray, lb: Letterbox) -> np.ndarray:
    b = boxes.copy()
    b[:, [0, 2]] = (b[:, [0, 2]] - lb.pad_x) / lb.scale
    b[:, [1, 3]] = (b[:, [1, 3]] - lb.pad_y) / lb.scale
    b[:, [0, 2]] = b[:, [0, 2]].clip(0, lb.src_w)
    b[:, [1, 3]] = b[:, [1, 3]].clip(0, lb.src_h)
    return b


# --------------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, default=ML_DIR / "models" / "yolo26n.onnx")
    ap.add_argument("--image", type=Path, default=ML_DIR / "samples" / "phone.jpg")
    ap.add_argument("--out", type=Path, default=ML_DIR / "samples" / "phone_detected.jpg")
    ap.add_argument("--conf", type=float, default=0.25, help="confidence threshold")
    ap.add_argument("--iou", type=float, default=0.45, help="NMS IoU threshold (only used by raw-head models)")
    ap.add_argument("--raw-box-format", choices=["auto", "xyxy", "xywh"], default="auto",
                    help="box encoding of raw-head models; auto inspects the values")
    ap.add_argument("--class-name", default="cell phone", help="class to keep (looked up in the model's names)")
    ap.add_argument("--show-all", action="store_true", help="also draw non-phone detections (grey)")
    ap.add_argument("--runs", type=int, default=20, help="timed runs for the latency measurement")
    args = ap.parse_args()

    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    outs = sess.get_outputs()
    meta = sess.get_modelmeta().custom_metadata_map
    names: dict[int, str] = ast.literal_eval(meta["names"])
    print(f"model   : {args.model.name}  (ONNX Runtime {ort.__version__})")
    print(f"input   : {inp.name} {inp.shape} {inp.type}")
    for o in outs:
        print(f"output  : {o.name} {o.shape} {o.type}")
    if len(outs) != 1:
        raise SystemExit("This script handles single-output detection models only (see evaluate_segmentation.py).")
    if not all(isinstance(d, int) for d in inp.shape):
        raise SystemExit(f"Dynamic input shape {inp.shape} not supported by this script")

    layout = infer_layout(outs[0].shape, len(names))
    print(f"layout  : {layout}  (metadata end2end={meta.get('end2end', 'n/a')})")

    phone_ids = [i for i, n in names.items() if n == args.class_name]
    if not phone_ids:
        raise SystemExit(f"Class {args.class_name!r} not in model names")
    phone_id = phone_ids[0]
    print(f"class   : {args.class_name!r} -> id {phone_id}")

    img = Image.open(args.image).convert("RGB")
    x, lb = preprocess(img, (inp.shape[2], inp.shape[3]))
    (raw,) = sess.run(None, {inp.name: x})
    print(f"raw out : shape={raw.shape} min={raw.min():.3f} max={raw.max():.3f}")

    t = []
    for _ in range(args.runs):
        t0 = time.perf_counter()
        sess.run(None, {inp.name: x})
        t.append((time.perf_counter() - t0) * 1000)
    print(f"latency : median {np.median(t):.1f} ms, p95 {np.percentile(t, 95):.1f} ms ({args.runs} runs, CPU, model only, excludes pre/postprocessing)")

    boxes, scores, cls = decode(raw, layout, args.conf, args.iou, args.raw_box_format)
    boxes = to_image_coords(boxes, lb)

    print(f"\nall detections (conf >= {args.conf}, iou {args.iou}): {len(boxes)}")
    for b, s, c in zip(boxes, scores, cls):
        print(f"  {names[int(c)]:<14} {s:.3f}  [{b[0]:.1f}, {b[1]:.1f}, {b[2]:.1f}, {b[3]:.1f}]")

    sel = cls == phone_id
    print(f"\n{args.class_name} detections: {int(sel.sum())}")
    for b, s in zip(boxes[sel], scores[sel]):
        print(f"  conf={s:.3f}  xyxy=[{b[0]:.1f}, {b[1]:.1f}, {b[2]:.1f}, {b[3]:.1f}]  "
              f"w={b[2]-b[0]:.1f} h={b[3]-b[1]:.1f}")

    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()
    lw = max(3, round(max(img.size) / 250))
    for b, s, c in zip(boxes, scores, cls):
        is_phone = int(c) == phone_id
        if not (is_phone or args.show_all):
            continue
        col = (48, 209, 88) if is_phone else (160, 160, 160)
        draw.rectangle(list(map(float, b)), outline=col, width=lw if is_phone else 1)
        label = f"{names[int(c)]} {s:.2f}"
        tw = draw.textlength(label, font=font)
        draw.rectangle([b[0], b[1] - 14, b[0] + tw + 6, b[1]], fill=col)
        draw.text((b[0] + 3, b[1] - 13), label, fill=(0, 0, 0), font=font)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    img.save(args.out, quality=92)
    print(f"\nannotated image -> {args.out}")


if __name__ == "__main__":
    main()
