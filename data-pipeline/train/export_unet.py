"""Export the best U-Net checkpoint to ONNX (fp32 and fp16), check parity, write the registry entry.

Parity gate (research-05): the same 512 x 512 window through PyTorch (CPU, fp32) and onnxruntime (CPU)
must agree to a max absolute probability difference below 1e-3 for fp32 and below 1e-2 for fp16.
The browser side of the gate (onnxruntime-web) lives in the frontend tests.

    python data-pipeline/train/export_unet.py --version v1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline"))
sys.path.insert(0, str(REPO / "data-pipeline" / "train"))

from common import load_tile, read_index, split_tiles  # noqa: E402
from rajo.paths import data_root, models_root  # noqa: E402


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default="v1")
    ap.add_argument("--tiles", default="")
    ap.add_argument("--window", type=int, default=512)
    a = ap.parse_args()

    import onnxruntime as ort
    import torch
    from unet_model import UNet, count_parameters, normalise

    root = data_root(REPO)
    tiles_dir = Path(a.tiles) if a.tiles else root / "train" / "tiles"
    ckpt_dir = root / "checkpoints" / f"unet-{a.version}"
    ck = torch.load(ckpt_dir / "best.pt", map_location="cpu")
    man = json.loads((ckpt_dir / "manifest.json").read_text(encoding="utf-8"))
    model = UNet(base=int(ck.get("base", 32)))
    model.load_state_dict(ck["model"])
    model.eval()
    print(f"[export] unet-{a.version}: best epoch {ck['epoch'] + 1}, {count_parameters(model) / 1e6:.2f} M parameters")

    out_dir = models_root(REPO) / "unet"
    out_dir.mkdir(parents=True, exist_ok=True)
    fp32 = out_dir / f"unet-{a.version}.onnx"
    dummy = torch.zeros(1, 6, a.window, a.window)
    torch.onnx.export(model, dummy, str(fp32), input_names=["image"], output_names=["logits"], opset_version=17,
                      dynamic_axes={"image": {0: "batch", 2: "height", 3: "width"}, "logits": {0: "batch", 2: "height", 3: "width"}},
                      do_constant_folding=True, dynamo=False)
    print(f"[export] fp32 {fp32.name} {fp32.stat().st_size / 1e6:.1f} MB")

    fp16 = out_dir / f"unet-{a.version}-fp16.onnx"
    try:
        import onnx
        from onnxconverter_common import float16

        m32 = onnx.load(str(fp32))
        m16 = float16.convert_float_to_float16(m32, keep_io_types=True)
        onnx.save(m16, str(fp16))
        print(f"[export] fp16 {fp16.name} {fp16.stat().st_size / 1e6:.1f} MB (float32 inputs and outputs kept)")
    except Exception as exc:  # the fp32 file is the deliverable; fp16 is the WebGPU optimisation
        print(f"[export] fp16 conversion failed: {type(exc).__name__}: {exc}")
        fp16 = None

    # parity on a real held-out window
    splits = split_tiles(read_index(tiles_dir))
    src = (splits["test"] or splits["val"] or splits["train"])[0]
    t = load_tile(tiles_dir / f"{src['tile_id']}.npz")
    h0 = (t["bands"].shape[1] - a.window) // 2
    x = torch.from_numpy(t["bands"][:, h0:h0 + a.window, h0:h0 + a.window]).unsqueeze(0)
    xin = normalise(x)
    with torch.no_grad():
        p_torch = torch.sigmoid(model(xin))[0, 0].numpy().astype(np.float64)
    parity = {}
    for label, path, tol in (("fp32", fp32, 1e-3), ("fp16", fp16, 1e-2)):
        if path is None:
            continue
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        t0 = time.time()
        logits = sess.run(None, {"image": xin.numpy().astype(np.float32)})[0]
        ms = (time.time() - t0) * 1000
        p = 1.0 / (1.0 + np.exp(-logits[0, 0].astype(np.float64)))
        d = np.abs(p - p_torch)
        parity[label] = {"tile_id": src["tile_id"], "window": a.window, "max_abs_diff": float(d.max()),
                         "mean_abs_diff": float(d.mean()), "threshold": tol, "pass": bool(d.max() < tol), "ort_cpu_ms": round(ms)}
        print(f"[export] parity {label}: max |dp| {d.max():.2e} (tol {tol}) -> {'PASS' if d.max() < tol else 'FAIL'}; ORT CPU {ms:.0f} ms")

    reg_path = models_root(REPO) / "registry.json"
    reg = json.loads(reg_path.read_text(encoding="utf-8")) if reg_path.exists() else {"schema": "rajo.models/v1", "models": []}
    entry = {"id": f"unet-{a.version}", "method": "M8", "name": "U-Net semantic segmentation", "file": f"unet/{fp32.name}",
             "file_fp16": f"unet/{fp16.name}" if fp16 else None, "bytes": fp32.stat().st_size, "sha256": _sha256(fp32),
             "bytes_fp16": fp16.stat().st_size if fp16 else None, "sha256_fp16": _sha256(fp16) if fp16 else None,
             "opset": 17, "input": "image[1,6,H,W] float32, reflectance clipped at 0.6 and scaled to [0,1]",
             "output": "logits[1,1,H,W]; probability = sigmoid", "channels": ["blue", "green", "red", "nir", "swir16", "swir22"],
             "parameters": count_parameters(model), "base_width": int(ck.get("base", 32)),
             "training": {k: man.get(k) for k in ("seed", "crop", "batch", "lr", "wd", "epochs_planned", "patience", "amp",
                                                  "train_crops", "val_tiles", "best_epoch", "best_val_pooled_iou")},
             "val_full": man.get("val_full"), "parity": parity,
             "training_data": "Jasansky et al. 2024, doi:10.5281/zenodo.14195737, CC BY-SA 4.0; pixels from Earth Search",
             "split": "published train/val/test; catalog sites held out", "engine_version": (REPO / "VERSION").read_text(encoding="utf-8").strip(),
             "license": "MIT (weights); training data CC BY-SA 4.0", "trained": time.strftime("%Y-%m-%d")}
    reg["models"] = [m for m in reg["models"] if m["id"] != entry["id"]] + [entry]
    reg_path.write_text(json.dumps(reg, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"[export] registry updated: {reg_path}")
    return 0 if all(v["pass"] for v in parity.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
