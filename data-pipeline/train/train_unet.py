"""M8: train the U-Net on the Jasansky 2024 tiles (research-05 protocol).

Two steps, both resumable:

1. ``--build-bank``: from every training and validation tile (catalog holdouts excluded, tiles with
   more than 10% cloud dropped) draw a fixed set of 256 x 256 crops, half centred on mined pixels and
   half uniform, and store them as memory-mapped uint16 arrays under the data root. Decompressing a
   2048 x 2048 tile costs about a second; a crop bank makes an epoch GPU-bound.
2. training: AdamW (lr 3e-4, weight decay 1e-4), cosine schedule, BCE + Dice over valid pixels, mixed
   precision, augmentations (flips, 90-degree rotations, brightness and contrast jitter, band dropout
   at 5%), early stopping on validation IoU with patience 8, a checkpoint per epoch, deterministic seeds
   recorded in the checkpoint manifest. Validation IoU is computed on full validation tiles with
   sliding-window inference (a subset per epoch, every tile at the end).

    python data-pipeline/train/train_unet.py --build-bank
    python data-pipeline/train/train_unet.py --epochs 40 --batch 16
    python data-pipeline/train/train_unet.py --resume            # continue from the last checkpoint

Checkpoints go to RAJO_CHECKPOINTS_ROOT (default: <data root>/checkpoints/unet-<version>); the ONNX
export, parity check and registry entry are export_unet.py.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "data-pipeline"))
sys.path.insert(0, str(REPO / "data-pipeline" / "train"))

from common import clean_mask, confusion, load_tile, read_index, scores, split_tiles, valid_mask  # noqa: E402
from rajo.paths import data_root  # noqa: E402

CROP = 256
CROPS_PER_TILE = 12
MAX_CLOUD = 0.10


def log(msg: str) -> None:
    print(f"[unet {time.strftime('%H:%M:%S')}] {msg}", flush=True)


# --- crop bank -----------------------------------------------------------------------------------------

def build_bank(tiles_dir: Path, bank_dir: Path, splits: dict[str, list[dict]], seed: int) -> None:
    from scipy import ndimage

    bank_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    for name in ("train", "val"):
        tiles = [m for m in splits[name] if m["cloud_frac"] <= MAX_CLOUD and m["data_frac"] >= 0.98]
        n = len(tiles) * CROPS_PER_TILE
        bands = np.lib.format.open_memmap(bank_dir / f"{name}.bands.npy", mode="w+", dtype=np.uint16, shape=(n, 6, CROP, CROP))
        labels = np.lib.format.open_memmap(bank_dir / f"{name}.label.npy", mode="w+", dtype=np.uint8, shape=(n, CROP, CROP))
        valids = np.lib.format.open_memmap(bank_dir / f"{name}.valid.npy", mode="w+", dtype=np.uint8, shape=(n, CROP, CROP))
        origin = []
        t0 = time.time()
        k = 0
        for i, m in enumerate(tiles):
            z = np.load(tiles_dir / f"{m['tile_id']}.npz")
            b, scl, lab = z["bands"], z["scl"], z["label"]
            valid = valid_mask(scl).astype(np.uint8)
            h, w = lab.shape
            # candidate centres: mined pixels eroded a little so the crop sees the mine, not only its edge
            core = ndimage.binary_erosion(lab.astype(bool), iterations=4)
            ys, xs = np.nonzero(core)
            for c in range(CROPS_PER_TILE):
                if c < CROPS_PER_TILE // 2 and len(ys):
                    j = rng.integers(len(ys))
                    cy, cx = int(ys[j]), int(xs[j])
                    y0 = int(np.clip(cy - CROP // 2 + rng.integers(-64, 65), 0, h - CROP))
                    x0 = int(np.clip(cx - CROP // 2 + rng.integers(-64, 65), 0, w - CROP))
                else:
                    y0 = int(rng.integers(0, h - CROP + 1))
                    x0 = int(rng.integers(0, w - CROP + 1))
                bands[k] = b[:, y0:y0 + CROP, x0:x0 + CROP]
                labels[k] = lab[y0:y0 + CROP, x0:x0 + CROP]
                valids[k] = valid[y0:y0 + CROP, x0:x0 + CROP]
                origin.append([m["tile_id"], y0, x0])
                k += 1
            if (i + 1) % 25 == 0 or i + 1 == len(tiles):
                log(f"  bank {name}: {i + 1}/{len(tiles)} tiles, {k} crops, {(time.time() - t0) / 60:.1f} min")
        bands.flush()
        labels.flush()
        valids.flush()
        pos = float(np.mean([labels[j].mean() for j in range(0, k, max(1, k // 500))])) if k else 0.0
        (bank_dir / f"{name}.json").write_text(json.dumps({
            "n": k, "crop": CROP, "crops_per_tile": CROPS_PER_TILE, "tiles": [m["tile_id"] for m in tiles],
            "origin": origin, "positive_frac_estimate": round(pos, 4), "seed": seed, "max_cloud": MAX_CLOUD,
        }) + "\n", encoding="utf-8", newline="\n")
        log(f"bank {name}: {k} crops from {len(tiles)} tiles, positive fraction about {pos:.3f}")


# --- data ----------------------------------------------------------------------------------------------

def make_dataset(bank_dir: Path, name: str, augment: bool, seed: int):
    import torch
    from torch.utils.data import Dataset
    from unet_model import normalise

    class Bank(Dataset):
        def __init__(self):
            self.bands = np.load(bank_dir / f"{name}.bands.npy", mmap_mode="r")
            self.label = np.load(bank_dir / f"{name}.label.npy", mmap_mode="r")
            self.valid = np.load(bank_dir / f"{name}.valid.npy", mmap_mode="r")
            self.n = int(json.loads((bank_dir / f"{name}.json").read_text(encoding="utf-8"))["n"])
            self.rng = np.random.default_rng(seed)

        def __len__(self):
            return self.n

        def __getitem__(self, i):
            b = torch.from_numpy(np.asarray(self.bands[i], dtype=np.float32) / 10000.0)
            y = torch.from_numpy(np.asarray(self.label[i], dtype=np.float32))
            v = torch.from_numpy(np.asarray(self.valid[i], dtype=np.float32))
            if augment:
                r = self.rng
                if r.random() < 0.5:
                    b, y, v = b.flip(-1), y.flip(-1), v.flip(-1)
                if r.random() < 0.5:
                    b, y, v = b.flip(-2), y.flip(-2), v.flip(-2)
                k = int(r.integers(0, 4))
                if k:
                    b, y, v = torch.rot90(b, k, (1, 2)), torch.rot90(y, k, (0, 1)), torch.rot90(v, k, (0, 1))
                gain = float(r.uniform(0.9, 1.1))
                bias = float(r.uniform(-0.02, 0.02))
                b = b * gain + bias
                if r.random() < 0.05:
                    b[int(r.integers(0, 6))] = 0.0
            return normalise(b), y.unsqueeze(0), v.unsqueeze(0)

    return Bank()


# --- validation on full tiles ----------------------------------------------------------------------------

def validate_tiles(model, tiles: list[dict], tiles_dir: Path, device, threshold: float = 0.5) -> dict:
    import torch
    from unet_model import predict_tile

    pooled = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
    ious = []
    for m in tiles:
        t = load_tile(tiles_dir / f"{m['tile_id']}.npz")
        prob = predict_tile(model, torch.from_numpy(t["bands"]), device=device).numpy()
        pred = clean_mask(prob, threshold)
        c = confusion(pred, t["label"], valid_mask(t["scl"]))
        for k in pooled:
            pooled[k] += c[k]
        s = scores(c)
        if math.isfinite(s["iou"]):
            ious.append(s["iou"])
    return {"pooled": {**scores(pooled), **pooled}, "per_tile_mean_iou": float(np.mean(ious)) if ious else float("nan"),
            "n_tiles": len(tiles)}


# --- training --------------------------------------------------------------------------------------------

def train(a, tiles_dir: Path, bank_dir: Path, ckpt_dir: Path, splits: dict[str, list[dict]]) -> int:
    import torch
    from torch.utils.data import DataLoader
    from unet_model import UNet, bce_dice_loss, count_parameters

    torch.manual_seed(a.seed)
    np.random.seed(a.seed)
    random.seed(a.seed)
    torch.backends.cudnn.benchmark = True
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log(f"device {device} ({torch.cuda.get_device_name(0) if device.type == 'cuda' else 'cpu'})")

    train_ds = make_dataset(bank_dir, "train", augment=True, seed=a.seed)
    loader = DataLoader(train_ds, batch_size=a.batch, shuffle=True, num_workers=a.workers, pin_memory=device.type == "cuda",
                        drop_last=True, persistent_workers=a.workers > 0)
    val_tiles = [m for m in splits["val"] if m["cloud_frac"] <= MAX_CLOUD and m["data_frac"] >= 0.98]
    val_subset = val_tiles[:: max(1, len(val_tiles) // a.val_tiles)][: a.val_tiles]
    log(f"train crops {len(train_ds)}, steps/epoch {len(loader)}, val tiles {len(val_tiles)} (subset {len(val_subset)} per epoch)")

    model = UNet(base=a.base).to(device)
    log(f"U-Net base {a.base}: {count_parameters(model) / 1e6:.2f} M parameters")
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=a.wd)
    total_steps = a.epochs * len(loader)
    warm = min(200, total_steps // 20)

    def lr_at(step: int) -> float:
        if step < warm:
            return a.lr * (step + 1) / warm
        p = (step - warm) / max(1, total_steps - warm)
        return a.lr * (0.02 + 0.98 * 0.5 * (1 + math.cos(math.pi * p)))

    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda" and a.amp)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = ckpt_dir / "manifest.json"
    start_epoch, best_iou, bad, history = 0, -1.0, 0, []
    if a.resume and (ckpt_dir / "last.pt").exists():
        ck = torch.load(ckpt_dir / "last.pt", map_location=device)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        scaler.load_state_dict(ck["scaler"])
        start_epoch, best_iou, bad, history = ck["epoch"] + 1, ck["best_iou"], ck["bad"], ck["history"]
        log(f"resumed from epoch {ck['epoch']} (best val IoU {best_iou:.4f})")

    step = start_epoch * len(loader)
    for epoch in range(start_epoch, a.epochs):
        model.train()
        t0 = time.time()
        loss_sum = 0.0
        for x, y, v in loader:
            for g in opt.param_groups:
                g["lr"] = lr_at(step)
            x, y, v = x.to(device, non_blocking=True), y.to(device, non_blocking=True), v.to(device, non_blocking=True)
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=scaler.is_enabled()):
                logits = model(x)
            loss = bce_dice_loss(logits.float(), y, v)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            loss_sum += loss.item()
            step += 1
        train_loss = loss_sum / max(1, len(loader))
        val = validate_tiles(model, val_subset, tiles_dir, device)
        iou = val["pooled"]["iou"]
        history.append({"epoch": epoch, "train_loss": round(train_loss, 5), "val_pooled_iou": round(iou, 5),
                        "val_pooled_f1": round(val["pooled"]["f1"], 5), "val_per_tile_iou": round(val["per_tile_mean_iou"], 5),
                        "lr": lr_at(step), "seconds": round(time.time() - t0, 1)})
        improved = iou > best_iou
        if improved:
            best_iou, bad = iou, 0
            torch.save({"model": model.state_dict(), "epoch": epoch, "val": val, "base": a.base}, ckpt_dir / "best.pt")
        else:
            bad += 1
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "scaler": scaler.state_dict(), "epoch": epoch,
                    "best_iou": best_iou, "bad": bad, "history": history, "base": a.base}, ckpt_dir / "last.pt")
        manifest_path.write_text(json.dumps({
            "version": a.version, "seed": a.seed, "base": a.base, "crop": CROP, "batch": a.batch, "lr": a.lr, "wd": a.wd,
            "epochs_planned": a.epochs, "patience": a.patience, "amp": bool(scaler.is_enabled()), "device": str(device),
            "train_crops": len(train_ds), "val_tiles": len(val_tiles), "val_subset": len(val_subset),
            "best_val_pooled_iou": best_iou, "history": history,
        }, indent=1) + "\n", encoding="utf-8", newline="\n")
        log(f"epoch {epoch + 1}/{a.epochs}: loss {train_loss:.4f}, val IoU {iou:.4f} (F1 {val['pooled']['f1']:.4f}), "
            f"{'best' if improved else f'no gain x{bad}'}, {time.time() - t0:.0f}s")
        if bad >= a.patience:
            log(f"early stop: no validation gain for {a.patience} epochs")
            break

    # the final word on validation: every validation tile through the best checkpoint
    ck = torch.load(ckpt_dir / "best.pt", map_location=device)
    model.load_state_dict(ck["model"])
    full = validate_tiles(model, val_tiles, tiles_dir, device)
    man = json.loads(manifest_path.read_text(encoding="utf-8"))
    man["best_epoch"] = ck["epoch"]
    man["val_full"] = full
    manifest_path.write_text(json.dumps(man, indent=1) + "\n", encoding="utf-8", newline="\n")
    log(f"best epoch {ck['epoch'] + 1}: full validation pooled IoU {full['pooled']['iou']:.4f}, "
        f"F1 {full['pooled']['f1']:.4f}, per-tile mean IoU {full['per_tile_mean_iou']:.4f}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiles", default="")
    ap.add_argument("--version", default="v1")
    ap.add_argument("--build-bank", action="store_true")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--base", type=int, default=32)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--wd", type=float, default=1e-4)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--val-tiles", type=int, default=48, help="validation tiles scored per epoch")
    ap.add_argument("--amp", action="store_true", default=True)
    ap.add_argument("--no-amp", dest="amp", action="store_false")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--max-tiles", type=int, default=0, help="smoke: cap every split before the bank")
    a = ap.parse_args()

    root = data_root(REPO)
    tiles_dir = Path(a.tiles) if a.tiles else root / "train" / "tiles"
    bank_dir = root / "train" / f"bank-{a.version}"
    ckpt_dir = root / "checkpoints" / f"unet-{a.version}"
    splits = split_tiles(read_index(tiles_dir))
    if a.max_tiles:
        for k in splits:
            splits[k] = splits[k][: a.max_tiles]
    log("tiles: " + ", ".join(f"{k} {len(v)}" for k, v in splits.items()))
    if a.build_bank:
        build_bank(tiles_dir, bank_dir, splits, a.seed)
        return 0
    if not (bank_dir / "train.json").exists():
        log(f"no crop bank at {bank_dir}: run with --build-bank first")
        return 2
    return train(a, tiles_dir, bank_dir, ckpt_dir, splits)


if __name__ == "__main__":
    raise SystemExit(main())
