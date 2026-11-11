#!/usr/bin/env python3
"""Score the phone detector on YOUR photos and recommend a confidence threshold.

Put images in two folders (git-ignored, see datasets/README.md):
    datasets/eval/positive/   photos that contain a phone
    datasets/eval/negative/   photos WITHOUT a phone: covers alone, remotes, wallets, empty desks, ...

For every image the script records the strongest "cell phone" score (after the same other-class suppression the
app applies) and the strongest other class. It then sweeps confidence thresholds and prints precision / recall /
F1, so you can see what a given threshold costs in false positives and misses before changing the app.

Examples
    python scripts/evaluate_images.py
    python scripts/evaluate_images.py --model models/yolo26s.onnx          # compare a bigger model (export it first)
    python scripts/evaluate_images.py --competitor-ratio 0 --csv out.csv    # without suppression, save per-image rows

This is an image-level evaluation (does the image produce a phone detection above the threshold?). It does not
check box accuracy, and the app additionally requires sustained, aligned detections, so real-world false
positives are lower than the numbers here.
"""
from __future__ import annotations

import argparse
import ast
import csv
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from test_model import decode, infer_layout, preprocess, to_image_coords  # same preprocessing/decoding as the app

ML_DIR = Path(__file__).resolve().parents[1]
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def iou(a: np.ndarray, b: np.ndarray) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return 0.0 if union <= 0 else inter / union


def list_images(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*") if p.suffix.lower() in IMAGE_EXTS) if folder.exists() else []


def score_image(sess, inp, layout, names, phone_id, path, competitor_ratio, competitor_iou):
    img = Image.open(path).convert("RGB")
    x, lb = preprocess(img, (inp.shape[2], inp.shape[3]))
    (raw,) = sess.run(None, {inp.name: x})
    boxes, scores, cls = decode(raw, layout, 0.05, 0.45)
    boxes = to_image_coords(boxes, lb)

    phone = [(float(s), b) for b, s, c in zip(boxes, scores, cls) if int(c) == phone_id]
    others = [(float(s), b, int(c)) for b, s, c in zip(boxes, scores, cls) if int(c) != phone_id]
    if competitor_ratio > 0:  # same rule as the app: another class explains the box at least as well
        phone = [
            (s, b) for s, b in phone
            if not any(os_ >= competitor_ratio * s and iou(ob, b) >= competitor_iou for os_, ob, _ in others)
        ]
    top_phone = max((s for s, _ in phone), default=0.0)
    top_other = max(others, key=lambda o: o[0], default=None)
    return top_phone, (names[top_other[2]] if top_other else ""), (top_other[0] if top_other else 0.0)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, default=ML_DIR / "models" / "yolo26n.onnx")
    ap.add_argument("--data", type=Path, default=ML_DIR / "datasets" / "eval")
    ap.add_argument("--class-name", default="cell phone")
    ap.add_argument("--competitor-ratio", type=float, default=0.8, help="0 disables other-class suppression (app default 0.8)")
    ap.add_argument("--competitor-iou", type=float, default=0.6)
    ap.add_argument("--csv", type=Path, help="write per-image results here")
    args = ap.parse_args()

    pos, neg = list_images(args.data / "positive"), list_images(args.data / "negative")
    if not pos or not neg:
        raise SystemExit(
            f"Need images in both {args.data / 'positive'} ({len(pos)} found) and {args.data / 'negative'} ({len(neg)} found).\n"
            "See ml/datasets/README.md for what to collect."
        )

    sess = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    inp, outs = sess.get_inputs()[0], sess.get_outputs()
    names: dict[int, str] = ast.literal_eval(sess.get_modelmeta().custom_metadata_map["names"])
    layout = infer_layout(outs[0].shape, len(names))
    phone_id = next((i for i, n in names.items() if n == args.class_name), None)
    if phone_id is None:
        raise SystemExit(f"Class {args.class_name!r} not in model names: {sorted(names.values())[:10]}...")
    print(f"model {args.model.name} · layout {layout} · class {args.class_name!r} (id {phone_id}) · "
          f"{len(pos)} positive / {len(neg)} negative images · competitor ratio {args.competitor_ratio}\n")

    rows = []  # (label, path, phone_score, other_class, other_score)
    t0 = time.perf_counter()
    for label, files in (("positive", pos), ("negative", neg)):
        for f in files:
            rows.append((label, f, *score_image(sess, inp, layout, names, phone_id, f, args.competitor_ratio, args.competitor_iou)))
    print(f"scored {len(rows)} images in {time.perf_counter() - t0:.1f}s\n")

    pos_scores = np.array([r[2] for r in rows if r[0] == "positive"])
    neg_scores = np.array([r[2] for r in rows if r[0] == "negative"])

    print(f"{'thr':>5} {'TP':>5} {'FN':>5} {'FP':>5} {'TN':>5} {'precision':>10} {'recall':>8} {'F1':>6}")
    best_f1, best_thr, strict_thr = -1.0, None, None
    for thr in np.arange(0.30, 0.951, 0.05):
        tp, fn = int((pos_scores >= thr).sum()), int((pos_scores < thr).sum())
        fp, tn = int((neg_scores >= thr).sum()), int((neg_scores < thr).sum())
        precision = tp / (tp + fp) if tp + fp else 1.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        print(f"{thr:5.2f} {tp:5d} {fn:5d} {fp:5d} {tn:5d} {precision:10.3f} {recall:8.3f} {f1:6.3f}")
        if f1 > best_f1:
            best_f1, best_thr = f1, thr
        if strict_thr is None and precision >= 0.95 and recall > 0:
            strict_thr = thr
    print(f"\nbest F1 {best_f1:.3f} at confidence {best_thr:.2f}")
    print(f"lowest threshold with precision >= 0.95: {strict_thr if strict_thr is not None else 'none in 0.30-0.95'}")
    print("→ use these as the app's per-frame floor (`minConfidence`) / mean (`minMeanConfidence`) in src/config/liveDetection.ts")

    print("\nworst false positives (negative images that still look like a phone):")
    for r in sorted((r for r in rows if r[0] == "negative"), key=lambda r: -r[2])[:10]:
        print(f"  {r[2]:.2f}  {r[1].relative_to(args.data)}   (strongest other class: {r[3] or '-'} {r[4]:.2f})")
    print("\nworst misses (positive images with the lowest phone score):")
    for r in sorted((r for r in rows if r[0] == "positive"), key=lambda r: r[2])[:10]:
        print(f"  {r[2]:.2f}  {r[1].relative_to(args.data)}   (strongest other class: {r[3] or '-'} {r[4]:.2f})")

    if args.csv:
        with args.csv.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["label", "image", "phone_score", "other_class", "other_score"])
            for r in rows:
                w.writerow([r[0], str(r[1]), f"{r[2]:.4f}", r[3], f"{r[4]:.4f}"])
        print(f"\nper-image results -> {args.csv}")


if __name__ == "__main__":
    main()
