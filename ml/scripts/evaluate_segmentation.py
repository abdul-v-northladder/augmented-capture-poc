#!/usr/bin/env python3
"""EVALUATION ONLY: does an instance-segmentation model give a better phone outline than a box?

The detection pipeline (test_model.py) is unchanged; this script runs the exported
`yolo26n-seg.onnx`, decodes the mask of every cell-phone detection into a polygon, and compares
it with the bounding box (area, rotated-rectangle fit, latency, model size).
"""
from __future__ import annotations

import argparse
import ast
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image

from test_model import ML_DIR, preprocess

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", type=Path, default=ML_DIR / "models" / "yolo26n-seg.onnx")
    ap.add_argument("--image", type=Path, default=ML_DIR / "samples" / "phone.jpg")
    ap.add_argument("--out", type=Path, default=ML_DIR / "samples" / "phone_segmented.jpg")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--mask-thr", type=float, default=0.5)
    ap.add_argument("--class-name", default="cell phone")
    ap.add_argument("--runs", type=int, default=20)
    args = ap.parse_args()

    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    meta = sess.get_modelmeta().custom_metadata_map
    names = ast.literal_eval(meta["names"])
    outs = sess.get_outputs()
    print("outputs:", [(o.name, o.shape) for o in outs])

    # Identify the two tensors from their shapes (rank 3 = detections+coeffs, rank 4 = mask prototypes).
    det_i = next(i for i, o in enumerate(outs) if len(o.shape) == 3)
    proto_i = next(i for i, o in enumerate(outs) if len(o.shape) == 4)
    n_coef = outs[proto_i].shape[1]
    assert outs[det_i].shape[2] == 6 + n_coef, "expected [x1,y1,x2,y2,score,cls, *mask_coeffs]"
    print(f"layout: detections [1,{outs[det_i].shape[1]},6+{n_coef}] + prototypes {outs[proto_i].shape[1:]}")

    img = Image.open(args.image).convert("RGB")
    inp = sess.get_inputs()[0]
    x, lb = preprocess(img, (inp.shape[2], inp.shape[3]))
    res = sess.run(None, {inp.name: x})
    det, protos = res[det_i][0], res[proto_i][0]

    t = []
    for _ in range(args.runs):
        t0 = time.perf_counter()
        sess.run(None, {inp.name: x})
        t.append((time.perf_counter() - t0) * 1000)
    print(f"latency: median {np.median(t):.1f} ms (CPU, model only)   size: {args.model.stat().st_size / 1e6:.2f} MB")

    phone_id = next(i for i, n in names.items() if n == args.class_name)
    rows = det[(det[:, 5].astype(int) == phone_id) & (det[:, 4] >= args.conf)]
    th, tw = inp.shape[2], inp.shape[3]
    vis = np.asarray(img).copy()
    for r in rows:
        x1, y1, x2, y2 = r[:4]
        coeffs = r[6:]
        # mask logits at prototype resolution -> sigmoid -> upsample to network input -> remove letterbox
        m = 1 / (1 + np.exp(-(coeffs @ protos.reshape(n_coef, -1)).reshape(protos.shape[1:])))
        m = cv2.resize(m, (tw, th), interpolation=cv2.INTER_LINEAR)
        box_mask = np.zeros_like(m)
        box_mask[int(max(y1, 0)):int(y2) + 1, int(max(x1, 0)):int(x2) + 1] = 1  # a mask is only valid inside its box
        m = m * box_mask
        px, py = int(round(lb.pad_x)), int(round(lb.pad_y))
        m = m[py:th - py, px:tw - px]
        m = cv2.resize(m, (lb.src_w, lb.src_h), interpolation=cv2.INTER_LINEAR) > args.mask_thr

        cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cnts, key=cv2.contourArea)
        poly = cv2.approxPolyDP(c, 0.01 * cv2.arcLength(c, True), True)[:, 0, :]
        rect = cv2.minAreaRect(c)
        bx1, by1 = (x1 - lb.pad_x) / lb.scale, (y1 - lb.pad_y) / lb.scale
        bx2, by2 = (x2 - lb.pad_x) / lb.scale, (y2 - lb.pad_y) / lb.scale
        box_area = (bx2 - bx1) * (by2 - by1)
        print(f"\nconf={r[4]:.3f}  box=[{bx1:.0f},{by1:.0f},{bx2:.0f},{by2:.0f}] area={box_area:.0f}px²")
        print(f"  mask area={m.sum()}px²  ({m.sum() / box_area:.0%} of the box)  polygon vertices={len(poly)}")
        print(f"  rotated rect: centre=({rect[0][0]:.0f},{rect[0][1]:.0f}) size={rect[1][0]:.0f}x{rect[1][1]:.0f} angle={rect[2]:.1f}°")
        tint = vis.copy()
        tint[m] = (0.5 * tint[m] + 0.5 * np.array([48, 209, 88])).astype(np.uint8)
        vis = tint
        cv2.polylines(vis, [poly.reshape(-1, 1, 2)], True, (255, 214, 10), 3)
        cv2.rectangle(vis, (int(bx1), int(by1)), (int(bx2), int(by2)), (255, 255, 255), 2)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(vis).save(args.out, quality=92)
    print(f"\nsegmentation overlay -> {args.out}  (white = box, yellow = polygon, green = mask)")

if __name__ == "__main__":
    main()
