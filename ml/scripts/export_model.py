#!/usr/bin/env python3
"""Download a pretrained Ultralytics YOLO checkpoint and export it to ONNX.

Writes next to the .onnx a `<name>.metadata.json` that records what was actually
found in the exported graph (inputs, outputs, opset, operator set, class names),
so downstream code never has to guess the tensor layout.

Examples
    python scripts/export_model.py                              # yolo26n, NMS-free head -> models/yolo26n.onnx
    python scripts/export_model.py --head raw                   # classic head (needs NMS) -> models/yolo26n-raw.onnx
    python scripts/export_model.py --model yolo11n.pt --head raw
    python scripts/export_model.py --model yolo26n-seg.pt       # segmentation variant (evaluation only)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from pathlib import Path

import onnx

ML_DIR = Path(__file__).resolve().parents[1]
MODELS_DIR = ML_DIR / "models"


def describe_value_info(vi: onnx.ValueInfoProto) -> dict:
    t = vi.type.tensor_type
    dims = [d.dim_value if d.HasField("dim_value") else (d.dim_param or "?") for d in t.shape.dim]
    return {"name": vi.name, "dtype": onnx.TensorProto.DataType.Name(t.elem_type), "shape": dims}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="yolo26n.pt", help="Ultralytics checkpoint name (auto-downloaded)")
    ap.add_argument("--imgsz", type=int, default=640, help="square input size baked into the graph")
    ap.add_argument("--opset", type=int, default=17, help="ONNX opset (17 is broadly supported by ORT mobile/web)")
    ap.add_argument("--no-simplify", action="store_true", help="skip onnxslim/onnx-simplifier pass")
    ap.add_argument(
        "--head",
        choices=["end2end", "raw"],
        default="end2end",
        help="end2end: NMS-free top-300 detections (N,300,6), YOLO26 only. "
        "raw: one-to-many predictions (N,4+nc,anchors); the consumer must run NMS.",
    )
    ap.add_argument("--half", action="store_true", help="FP16 export (not recommended for ORT Web/WASM)")
    args = ap.parse_args()

    from ultralytics import YOLO  # imported late so --help is instant

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    weights = MODELS_DIR / args.model

    # Ultralytics downloads the official asset to this path when it does not exist yet.
    model = YOLO(str(weights))
    print(f"[export] task={model.task} classes={len(model.names)} weights={weights}")

    export_kwargs = dict(
        format="onnx",
        imgsz=args.imgsz,
        opset=args.opset,
        simplify=not args.no_simplify,
        dynamic=False,  # fixed 1x3xHxW: smallest/most portable for mobile + web runtimes
        batch=1,
        half=args.half,
    )
    # NOTE: Ultralytics' *default* ONNX export of YOLO26 is the raw head, not NMS-free (verified).
    # `end2end=True/False` selects the head explicitly. We never use nms=True: it embeds
    # NonMaxSuppression/NonZero/ScatterND, which are the least portable ops for mobile/web runtimes.
    # Export from a scratch copy: Ultralytics always writes `<stem>.onnx` next to the weights, which
    # would otherwise overwrite the other head's file.
    stem = Path(args.model).stem
    final_name = f"{stem}.onnx" if args.head == "end2end" else f"{stem}-raw.onnx"
    with tempfile.TemporaryDirectory() as tmp:
        scratch_weights = Path(tmp) / weights.name
        shutil.copy(weights, scratch_weights)
        scratch_model = YOLO(str(scratch_weights))
        try:
            produced = Path(scratch_model.export(**export_kwargs, end2end=(args.head == "end2end")))
        except Exception as e:  # models without an end2end option (e.g. YOLOv8/11)
            if args.head == "end2end":
                raise SystemExit(f"{args.model} has no NMS-free head ({e}). Use --head raw.")
            produced = Path(scratch_model.export(**export_kwargs))
        exported = MODELS_DIR / final_name
        shutil.move(str(produced), exported)

    onnx_path = exported
    print(f"[export] wrote {onnx_path} ({onnx_path.stat().st_size / 1e6:.2f} MB)")

    # ---- inspect what was really exported ---------------------------------------------------
    graph = onnx.load(str(onnx_path))
    onnx.checker.check_model(graph)
    initializer_names = {i.name for i in graph.graph.initializer}
    meta = {
        "file": onnx_path.name,
        "source_checkpoint": args.model,
        "task": model.task,
        "size_bytes": onnx_path.stat().st_size,
        "sha256": hashlib.sha256(onnx_path.read_bytes()).hexdigest(),
        "opset": {o.domain or "ai.onnx": o.version for o in graph.opset_import},
        "ir_version": graph.ir_version,
        "inputs": [describe_value_info(i) for i in graph.graph.input if i.name not in initializer_names],
        "outputs": [describe_value_info(o) for o in graph.graph.output],
        "operators": sorted({n.op_type for n in graph.graph.node}),
        "class_names": {int(k): v for k, v in model.names.items()},
        "model_metadata_props": {p.key: p.value for p in graph.metadata_props},
        "export_args": {**export_kwargs, "head": args.head},
    }
    meta_path = onnx_path.with_suffix(".metadata.json")
    meta_path.write_text(json.dumps(meta, indent=2))

    print("[export] inputs :", json.dumps(meta["inputs"]))
    print("[export] outputs:", json.dumps(meta["outputs"]))
    print("[export] opset  :", meta["opset"])
    print("[export] ops    :", ", ".join(meta["operators"]))
    print(f"[export] metadata -> {meta_path}")


if __name__ == "__main__":
    main()
