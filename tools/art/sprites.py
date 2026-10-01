#!/usr/bin/env python3
"""Builds the hand-drawn sprite animations (slaps and chat reactions).

Input: the animation pack supplied as art, unpacked to art/sprites/:

  art/sprites/manifest.json                 sheets + animations ([frame, seconds] lists)
  art/sprites/<milestone>_<Char>_<Kind>/<n>.png

<milestone> is 0k, 20k, 40k, 60k, 80k or 100k (outfit stages 0-5), <Char> is
Buy or Sell and <Kind> is Slap, Reaction or Chat. Every frame is a full-body
pose on a flat grey backdrop. The script keys the backdrop out, drops bits of
neighbouring poses that bleed in from the sheet, stands every frame on the
same baseline (the boots) and writes, per stage,

  client/src/assets/sprites/s<stage>/<Char>_<Kind>.<n>.webp
  client/src/assets/sprites/s<stage>.json

It also reports frames where the figure runs off the tile edge.

Usage: python3 tools/art/sprites.py [stage ...]   (default: every stage)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'art' / 'sprites'
OUT = ROOT / 'client' / 'src' / 'assets' / 'sprites'
MILESTONES = ['0k', '20k', '40k', '60k', '80k', '100k']
PAD = 6
# Where the slapped cheek is in each reaction's recoil frame, in source pixels
# relative to the boots (x right, y up is negative). The runtime spaces the
# two characters so the slapping palm lands here. Stages without their own
# entry use stage 0's.
CHEEKS = {
    0: {'Buy_Reaction': [10, -470], 'Sell_Reaction': [25, -470]},
}
# Contact happens this many seconds into the attacker's slap; the defender's
# reaction starts DEFENDER_DELAY seconds after the slap (the pack's notes).
CONTACT_S = 0.65
DEFENDER_DELAY = 0.2


def key_out(rgb: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """RGBA with the flat grey backdrop removed and edge colours unmixed, plus
    the tile edges the figure runs into (a hand or hair cut off by the tile)."""
    h, w, _ = rgb.shape
    a = rgb.astype(np.float32)
    border = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3),
                             a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    d = np.abs(a - bg).max(axis=2)
    v = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    # Backdrop: the flat grey, plus the slightly darker or lighter neutral grey
    # the art leaves in narrow gaps (between hair strands and fingers, under an
    # arm). The characters wear no neutral grey, so every such pixel is
    # backdrop, enclosed or not.
    near = (d <= 12) | ((sat < 14) & (np.abs(v - bg.mean()) < 30))
    # Soft grey floor shadows under the boots (some sheets have them).
    shadow = (sat < 10) & (v < bg.mean() - 4) & (v > 90)
    shadow[: int(h * 0.82)] = False
    back = near | shadow
    alpha = np.where(back, 0.0, 1.0).astype(np.float32)
    # Soft edge: pixels next to the backdrop take opacity from how far their
    # colour is from grey (anti-aliasing, motion streaks, sweat marks).
    band = cv2.dilate(back.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    ramp = np.clip((d - 6) / 60, 0, 1)
    alpha = np.where(band & ~back, ramp, alpha)
    alpha[alpha < 0.05] = 0
    # Frames were sliced from a sheet, so bits of the neighbouring poses can
    # poke in at the edges: drop pieces that touch an edge unless they are
    # part of the figure itself, and feather what the edge cuts through.
    n, lab, stats, _ = cv2.connectedComponentsWithStats((alpha > 0).astype(np.uint8), connectivity=8)
    if n > 1:
        main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        for i in range(1, n):
            x, y, bw, bh, _ = stats[i]
            # Keep large pieces: a tile can hold both characters (Pair sheets).
            big = stats[i, cv2.CC_STAT_AREA] > 0.2 * stats[main, cv2.CC_STAT_AREA]
            if i != main and not big and (x == 0 or y == 0 or x + bw == w or y + bh == h):
                alpha[lab == i] = 0
    solid = alpha > 0.8
    sides = [k for k, v in {'left': solid[:, :2], 'right': solid[:, w - 2:], 'top': solid[:2, :]}.items() if v.sum() > 12]
    ramp_x = np.clip(np.minimum(np.arange(w), w - 1 - np.arange(w)) / 6, 0, 1)
    alpha *= ramp_x[None, :]
    safe = np.maximum(alpha, 1e-3)[..., None]
    col = np.clip(bg + (a - bg) / safe, 0, 255)
    col = np.where(alpha[..., None] > 0, col, 0)
    return np.dstack([col, alpha * 255]).astype(np.uint8), sides


def body_box(rgba: np.ndarray) -> tuple[int, int, int, int]:
    """Bounding box of the solid figure (ignores faint streaks)."""
    ys, xs = np.nonzero(rgba[..., 3] > 200)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def feet_x(rgba: np.ndarray) -> float:
    """Horizontal centre of the boots (bottom 6% of the figure)."""
    x0, y0, x1, y1 = body_box(rgba)
    band = rgba[y1 - int((y1 - y0) * 0.06):y1, :, 3] > 200
    xs = np.nonzero(band.any(axis=0))[0]
    return float(xs.min() + xs.max()) / 2


def frame_at(frames: list[list[float]], t: float) -> int:
    acc = 0.0
    for i, (_, d) in enumerate(frames):
        if acc + d > t + 1e-6:
            return i
        acc += d
    return len(frames) - 1


def hand_tip(rgba: np.ndarray, anchor: tuple[float, float], facing: int) -> list[float]:
    """Palm of the slapping hand: the figure's furthest point toward the opponent in its upper half."""
    a = rgba[: rgba.shape[0] // 2, :, 3] > 160
    cols = np.nonzero(a.any(axis=0))[0]
    tip = cols.max() if facing > 0 else cols.min()
    near = a[:, max(0, tip - 14):tip + 1] if facing > 0 else a[:, tip:tip + 15]
    ys = np.nonzero(near.any(axis=1))[0]
    return [round(float(tip - facing * 12 - anchor[0]), 1), round(float(ys.mean() - anchor[1]), 1)]


def build_sheet(folder: Path, out: Path, name: str, shared_anchor: bool, warnings: list[str]) -> dict:
    """Keys and aligns one folder of frames into a common box."""
    frames = sorted(folder.glob('*.png'), key=lambda p: int(p.stem))
    keyed = [key_out(np.array(Image.open(f).convert('RGB'))) for f in frames]
    cut = [c for c, _ in keyed]
    for i, (_, sides) in enumerate(keyed):
        if sides:
            warnings.append(f'{folder.name}/{i}.png runs off the {" and ".join(sides)} edge')
    boxes = [body_box(c) for c in cut]
    heights = [b[3] - b[1] for b in boxes]
    if shared_anchor:
        # Slaps and reactions: one anchor from the standing frames (first and
        # last), so a lunge steps away from where she stands.
        a = (feet_x(cut[0]) + feet_x(cut[-1])) / 2
        anchors = [a] * len(cut)
    else:
        # Chat poses stand in place: each frame on its own boots.
        anchors = [feet_x(c) for c in cut]
    lx = min(b[0] - a for b, a in zip(boxes, anchors)) - PAD
    rx = max(b[2] - a for b, a in zip(boxes, anchors)) + PAD
    ty = min(b[1] - b[3] for b in boxes) - PAD
    w, h = int(np.ceil(rx - lx)), int(np.ceil(-ty)) + PAD
    files = []
    for i, (c, b, a) in enumerate(zip(cut, boxes, anchors)):
        canvas = np.zeros((h, w, 4), np.uint8)
        dx = int(round(-lx - a))
        dy = int(round(-ty - b[3]))
        H, W = c.shape[:2]
        xs0, ys0 = max(0, -dx), max(0, -dy)
        xs1, ys1 = min(W, w - dx), min(H, h - dy)
        canvas[ys0 + dy:ys1 + dy, xs0 + dx:xs1 + dx] = c[ys0:ys1, xs0:xs1]
        fn = f'{name}.{i}.webp'
        Image.fromarray(canvas).save(out / fn, 'WEBP', quality=78, method=6)
        files.append(fn)
    return {
        'files': files, 'width': w, 'height': h,
        # Centre of the boots on the floor, inside the frame.
        'anchor': [round(-lx, 1), h - PAD],
        'figureHeight': float(np.median(heights)),
    }


def build(stage: int, manifest: dict) -> list[str]:
    ms = MILESTONES[stage]
    out = OUT / f's{stage}'
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('*.webp'):
        old.unlink()
    warnings: list[str] = []
    meta: dict = {'contactSeconds': CONTACT_S, 'defenderDelay': DEFENDER_DELAY, 'sheets': {}, 'animations': {}}
    for folder in sorted(SRC.glob(f'{ms}_*')):
        if not folder.is_dir() or not any(folder.glob('*.png')):
            continue
        name = folder.name[len(ms) + 1:]  # e.g. Buy_Slap, Sell_Chat
        meta['sheets'][name] = build_sheet(folder, out, name, not name.endswith('_Chat'), warnings)
    for key, anim in manifest['animations'].items():
        if not key.startswith(ms + '_'):
            continue
        sheet = anim['sheet'][len(ms) + 1:]
        if sheet not in meta['sheets']:
            continue
        meta['animations'][key[len(ms) + 1:]] = {'sheet': sheet, 'frames': anim['frames']}
    # A folder the manifest does not describe (e.g. <milestone>_Buy_Dance)
    # plays its frames in order, 0.28 s each.
    used = {a['sheet'] for a in meta['animations'].values()}
    for name, sh in meta['sheets'].items():
        if name not in used and not name.endswith('_Chat'):
            meta['animations'][name] = {'sheet': name, 'frames': [[i, 0.28] for i in range(len(sh['files']))]}
    for char, facing in (('Buy', 1), ('Sell', -1)):
        slap = meta['animations'].get(f'{char}_Slap')
        if slap:
            sh = meta['sheets'][slap['sheet']]
            k = slap['frames'][frame_at(slap['frames'], CONTACT_S)][0]
            img = np.array(Image.open(out / sh['files'][k]))
            sh['contactFrame'] = k
            sh['hand'] = hand_tip(img, (sh['anchor'][0], sh['anchor'][1]), facing)
        react = meta['sheets'].get(f'{char}_Reaction')
        if react:
            react['cheek'] = CHEEKS.get(stage, CHEEKS[0])[f'{char}_Reaction']
    (OUT / f's{stage}.json').write_text(json.dumps(meta, indent=1))
    missing = [f'{c}_{k}' for c in ('Buy', 'Sell') for k in ('Slap', 'Reaction', 'Chat') if f'{c}_{k}' not in meta['sheets']]
    print(f's{stage} ({ms}): {len(meta["sheets"])} sheets, {len(meta["animations"])} animations'
          + (f'; missing {", ".join(missing)}' if missing else ''))
    for wmsg in warnings:
        print('   ', wmsg)
    return warnings


def main() -> None:
    manifest = json.loads((SRC / 'manifest.json').read_text())
    stages = [int(s.lstrip('s')) for s in sys.argv[1:]] or list(range(len(MILESTONES)))
    for st in stages:
        build(st, manifest)


if __name__ == '__main__':
    main()
