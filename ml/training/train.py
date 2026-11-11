#!/usr/bin/env python3
"""Fine-tune YOLO26n on your own phone / phone-case images, then export it for the app.

    python training/train.py --data training/data.yaml            # needs a labelled dataset, see training/README.md
    python training/train.py --data training/data.yaml --model yolo26s.pt --epochs 80 --batch 16

The best weights are copied to models/phone-detector.pt. Export them exactly like the stock model:

    python scripts/export_model.py --model phone-detector.pt     # -> models/phone-detector.onnx (+ metadata json)

Training is an offline, one-off step on a laptop/GPU box; nothing here runs in the app.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]


def check_dataset(data_yaml: Path) -> None:
    """Fail early with a readable message instead of a deep Ultralytics stack trace."""
    import yaml

    cfg = yaml.safe_load(data_yaml.read_text())
    root = (data_yaml.parent / cfg["path"]).resolve()
    problems = []
    for split in ("train", "val"):
        images = root / cfg[split]
        labels = root / str(cfg[split]).replace("images", "labels", 1)
        n_img = len([p for p in images.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]) if images.exists() else 0
        n_lab = len(list(labels.glob("*.txt"))) if labels.exists() else 0
        print(f"[data] {split}: {n_img} images, {n_lab} label files in {images}")
        if n_img == 0:
            problems.append(f"no images in {images}")
        elif n_lab < n_img:
            problems.append(f"{split}: {n_img - n_lab} image(s) have no label file (use an empty .txt for 'nothing here')")
    if problems:
        raise SystemExit("Dataset problems:\n  - " + "\n  - ".join(problems))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=ML_DIR / "training" / "data.yaml")
    ap.add_argument("--model", default="yolo26n.pt", help="starting checkpoint (auto-downloaded into models/)")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=640, help="must match the app's input size (640)")
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default=None, help="e.g. 0 (CUDA), mps (Apple), cpu; default: auto")
    ap.add_argument("--name", default="phone-detector")
    args = ap.parse_args()

    if not args.data.exists():
        raise SystemExit(f"{args.data} not found. Copy training/data.template.yaml to training/data.yaml and edit it.")
    check_dataset(args.data)

    from ultralytics import YOLO  # imported late so --help is instant

    model = YOLO(str(ML_DIR / "models" / args.model))
    model.train(
        data=str(args.data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=str(ML_DIR / "training" / "runs"),
        name=args.name,
        exist_ok=True,
        # Phones are filmed at any angle/orientation under any light: keep geometric and colour augmentation on.
        degrees=10.0,
        perspective=0.0005,
        fliplr=0.5,
        hsv_h=0.015,
        hsv_s=0.6,
        hsv_v=0.4,
        mosaic=1.0,
        close_mosaic=10,
    )
    metrics = model.val()
    print(f"[val] mAP50 {metrics.box.map50:.3f}  mAP50-95 {metrics.box.map:.3f}  "
          f"precision {metrics.box.mp:.3f}  recall {metrics.box.mr:.3f}")

    best = ML_DIR / "training" / "runs" / args.name / "weights" / "best.pt"
    out = ML_DIR / "models" / "phone-detector.pt"
    shutil.copy2(best, out)
    print(f"[done] best weights -> {out}\nnext: python scripts/export_model.py --model phone-detector.pt")


if __name__ == "__main__":
    main()
