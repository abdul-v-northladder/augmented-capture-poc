# Fine-tuning a phone detector

The stock `yolo26n` knows 80 COCO objects and has no idea what a **phone cover** is, so a cover alone can score as
`cell phone`. Thresholds and filters in the app only reduce this. Training on your own images, with covers as an
explicit negative class, is the real fix.

## 1. Collect images (this is most of the work)
Use the phone camera the app will use. Roughly:

| Content | Why | Aim for |
|---|---|---|
| Phones in a hand / on a table / in the capture frame, front and back, tilted, partly covered by fingers | positives | 300–500 |
| Flip phones open, half-open, closed (label as `phone`) | second device type | 100+ |
| **Covers/cases on their own**, inside out, on tables, in hands (label as `phone_case`) | the false positive you saw | 200+ |
| Look-alikes with **no label**: remotes, wallets, power banks, tablets, notebooks | hard negatives | 100+ |
| Empty desks, hands only, backgrounds with **no label** | background | 10–20 % of all images |

Vary lighting, backgrounds, distance (the app wants the phone to fill ≥ 50 % of the frame) and orientation.
Split by *session*, not randomly, so train and validation never contain near-duplicate shots (e.g. 80/20 by scene).

## 2. Label
Any YOLO-format tool works: Label Studio, CVAT, Roboflow, labelImg. Classes: `0 phone`, `1 phone_case`
(see `data.template.yaml`). An image with nothing to detect gets an **empty** `.txt` file.

```
ml/datasets/phones/images/{train,val}/*.jpg
ml/datasets/phones/labels/{train,val}/*.txt
```

## 3. Train and export
```bash
cd ml && source .venv/bin/activate
cp training/data.template.yaml training/data.yaml
python training/train.py --data training/data.yaml            # add --device mps | 0 | cpu if needed
python scripts/export_model.py --model phone-detector.pt      # -> models/phone-detector.onnx + metadata.json
```
`train.py` checks the dataset first, trains, prints precision/recall/mAP on the validation set and copies the best
weights to `models/phone-detector.pt`. Compare it with the stock model on your own held-out photos using
`python scripts/evaluate_images.py --model models/phone-detector.onnx` (use `--class-name phone`).

Reading the numbers: precision = how often a detection is really a phone (false positives lower it), recall = how
many real phones are found. For this app, favour precision first, then recall. A model that confuses covers with
phones will show it as `phone_case` images scoring high for `phone` in `evaluate_images.py`.

## 4. Switch the app to it
1. `cp ml/models/phone-detector.onnx assets/models/` (and add it to `scripts/setup-ml-assets.js` like the stock model).
2. In `src/ml/config/activeModel.ts` follow the "custom model" comment: new asset resolver + `PHONE_DETECTOR_CONFIG`
   (`classNames: ['phone', 'phone_case']`, `targetClassName: 'phone'`).
3. Rebuild the dev build (a new bundled asset) and test with the HUD's `phone` / `also` readings.

## Licence
Ultralytics weights and code are **AGPL-3.0**; fine-tuned weights inherit that. Get legal sign-off before shipping
(see `ml/README.md`), or train a permissively licensed architecture instead.
