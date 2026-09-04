"""M8: the U-Net used by the learned lane (research-05).

Four-level encoder-decoder with skip connections, base width 32 (32-64-128-256, bottleneck 512),
batch normalisation, ReLU, bilinear up-sampling followed by concatenation and two convolutions, a 1 x 1
head producing one logit per pixel. Six input channels (blue, green, red, nir, swir16, swir22) at 10 m,
reflectance clipped to [0, 0.6] and scaled to [0, 1] by ``normalise``. About 7.8 M parameters.

Everything here exports to ONNX opset 17 with dynamic spatial axes and runs in onnxruntime-web (WASM
and WebGPU): only Conv, BatchNorm (folded), ReLU, MaxPool, Resize (linear, half_pixel) and Concat.
Ronneberger, Fischer, Brox 2015, doi:10.1007/978-3-319-24574-4_28.
"""
from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn

IN_CHANNELS = 6
REFL_CLIP = 0.6


def normalise(x: torch.Tensor) -> torch.Tensor:
    """Reflectance (any shape) -> [0, 1]: clip at 0.6 and scale. The browser applies the same two ops."""
    return torch.clamp(x, 0.0, REFL_CLIP) / REFL_CLIP


class DoubleConv(nn.Module):
    def __init__(self, cin: int, cout: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class Up(nn.Module):
    def __init__(self, cin: int, cskip: int, cout: int):
        super().__init__()
        self.conv = DoubleConv(cin + cskip, cout)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = F.interpolate(x, scale_factor=2.0, mode="bilinear", align_corners=False)
        return self.conv(torch.cat([skip, x], dim=1))


class UNet(nn.Module):
    def __init__(self, in_channels: int = IN_CHANNELS, base: int = 32):
        super().__init__()
        w = [base, base * 2, base * 4, base * 8, base * 16]
        self.enc1 = DoubleConv(in_channels, w[0])
        self.enc2 = DoubleConv(w[0], w[1])
        self.enc3 = DoubleConv(w[1], w[2])
        self.enc4 = DoubleConv(w[2], w[3])
        self.bottleneck = DoubleConv(w[3], w[4])
        self.up4 = Up(w[4], w[3], w[3])
        self.up3 = Up(w[3], w[2], w[2])
        self.up2 = Up(w[2], w[1], w[1])
        self.up1 = Up(w[1], w[0], w[0])
        self.head = nn.Conv2d(w[0], 1, 1)
        self.pool = nn.MaxPool2d(2)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        e4 = self.enc4(self.pool(e3))
        b = self.bottleneck(self.pool(e4))
        d4 = self.up4(b, e4)
        d3 = self.up3(d4, e3)
        d2 = self.up2(d3, e2)
        d1 = self.up1(d2, e1)
        return self.head(d1)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def bce_dice_loss(logits: torch.Tensor, target: torch.Tensor, valid: torch.Tensor, eps: float = 1.0) -> torch.Tensor:
    """BCE + soft Dice over valid pixels only (clouds and no-data carry no gradient)."""
    bce = F.binary_cross_entropy_with_logits(logits, target, reduction="none")
    bce = (bce * valid).sum() / valid.sum().clamp_min(1.0)
    p = torch.sigmoid(logits) * valid
    t = target * valid
    inter = (p * t).sum(dim=(1, 2, 3))
    dice = 1.0 - (2.0 * inter + eps) / (p.sum(dim=(1, 2, 3)) + t.sum(dim=(1, 2, 3)) + eps)
    return bce + dice.mean()


def predict_tile(model: nn.Module, bands: torch.Tensor, window: int = 512, overlap: int = 64,
                 device: torch.device | None = None) -> torch.Tensor:
    """Sliding-window inference over a (6, H, W) reflectance tensor with overlap-tile blending (a
    cosine ramp on the overlap), returning probabilities (H, W). The browser mirrors this on the live
    grid."""
    device = device or next(model.parameters()).device
    _, h, w = bands.shape
    x = normalise(bands).unsqueeze(0).to(device)
    prob = torch.zeros((h, w), dtype=torch.float32, device=device)
    weight = torch.zeros((h, w), dtype=torch.float32, device=device)
    ramp = torch.ones(window, device=device)
    if overlap > 0:
        r = 0.5 * (1.0 - torch.cos(torch.linspace(0, torch.pi, overlap, device=device)))
        ramp[:overlap] = r
        ramp[-overlap:] = r.flip(0)
    w2d = ramp[:, None] * ramp[None, :]
    step = window - overlap
    ys = list(range(0, max(1, h - window + 1), step))
    xs = list(range(0, max(1, w - window + 1), step))
    if ys[-1] + window < h:
        ys.append(h - window)
    if xs[-1] + window < w:
        xs.append(w - window)
    model.eval()
    with torch.no_grad():
        for y0 in ys:
            for x0 in xs:
                y1, x1 = min(h, y0 + window), min(w, x0 + window)
                patch = x[:, :, y0:y1, x0:x1]
                ph, pw = patch.shape[2], patch.shape[3]
                pad = (0, window - pw, 0, window - ph)
                if pad != (0, 0, 0, 0):
                    patch = F.pad(patch, pad, mode="reflect")
                out = torch.sigmoid(model(patch))[0, 0, :ph, :pw]
                wt = w2d[:ph, :pw]
                prob[y0:y1, x0:x1] += out * wt
                weight[y0:y1, x0:x1] += wt
    return (prob / weight.clamp_min(1e-6)).cpu()
