# Evaluation photos

`scripts/evaluate_images.py` measures the detector on **your** photos. The images are git-ignored (see `.gitignore`).

```
datasets/eval/positive/   photos that contain a phone
datasets/eval/negative/   photos with NO phone
```

Collect with the same phone camera the app will use, in the conditions it will see:

| Folder | What to put in | Aim for |
|---|---|---|
| `positive` | Phones held in a hand and on a table; front and back; different colours and cases; flip phones open and closed; dim and bright light; tilted | 100+ |
| `negative` | **Phone covers/cases on their own** (the failure you saw), remotes, wallets, power banks, notebooks, tablets, empty desks, hands only | 100+ (many covers) |

Then run (from `ml/`, with the venv active):

```bash
python scripts/evaluate_images.py
```

It prints precision/recall per confidence threshold, the lowest threshold with ≥ 95 % precision, and the worst
false positives and misses. Use the result to set `minConfidence` / `minMeanConfidence` in
`src/config/liveDetection.ts`. If covers still score high at any threshold that keeps real phones, threshold tuning
cannot fix it: fine-tune the model (see `ml/training/README.md`).
