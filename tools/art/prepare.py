"""
Builds the illustrated rig assets from the source character illustrations.

    python3 tools/art/prepare.py            # uses cached cutouts in art/work
    python3 tools/art/prepare.py --recut    # re-runs background removal

Requires Pillow, numpy and opencv-contrib-python-headless (for xphoto);
--recut also needs rembg.

Inputs:  art/source/<variant>.png  (full-body illustrations, see layout.py)
Outputs: client/src/assets/rig/<id>/*.webp and client/src/assets/rig/<id>.json

For each outfit variant the illustration is:
  1. cut out from its background (rembg, isnet-anime model);
  2. aligned to the first variant (SIFT + similarity transform), so stage
     swaps line up pixel for pixel;
  3. split into a body, a head and the slapping forearm. The body under the
     head and forearm is filled by inpainting so moving parts never reveal
     holes;
  4. for Sell, the garment that differs from the next stage is cut out of
     each stage as its own falling piece.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'art' / 'source'
WORK = ROOT / 'art' / 'work'
OUT = ROOT / 'client' / 'src' / 'assets' / 'rig'

sys.path.insert(0, str(Path(__file__).parent))
from layout import LAYOUT  # noqa: E402

# Garment layers in unlock order (shared by both characters).
SELL_LAYERS = ['jacket', 'sash', 'skirt', 'shorts', 'cropTop']


# ------------------------------------------------------------------ helpers

def cutout(name: str, recut: bool) -> np.ndarray:
    """RGBA uint8 array of the illustration with its background removed."""
    cached = WORK / f'{name}-cut.png'
    if recut or not cached.exists():
        from rembg import new_session, remove

        WORK.mkdir(parents=True, exist_ok=True)
        session = new_session('isnet-anime')
        remove(Image.open(SRC / f'{name}.png').convert('RGB'), session=session).save(cached)
    im = np.array(Image.open(cached).convert('RGBA'))
    # Drop the faint glow halo the matting keeps from the backdrop.
    im[..., 3][im[..., 3] < 24] = 0
    return im


def align(ref_name: str, name: str, im: np.ndarray) -> np.ndarray:
    """Warps a stage image onto the reference illustration's frame."""
    ref = cv2.cvtColor(cv2.imread(str(SRC / f'{ref_name}.png')), cv2.COLOR_BGR2GRAY)
    cur = cv2.cvtColor(cv2.imread(str(SRC / f'{name}.png')), cv2.COLOR_BGR2GRAY)
    sift = cv2.SIFT_create(4000)
    kr, dr = sift.detectAndCompute(ref, None)
    kc, dc = sift.detectAndCompute(cur, None)
    matches = cv2.BFMatcher().knnMatch(dc, dr, k=2)
    good = [a for a, b in matches if a.distance < 0.75 * b.distance]
    src = np.float32([kc[m.queryIdx].pt for m in good])
    dst = np.float32([kr[m.trainIdx].pt for m in good])
    M, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4)
    h, w = im.shape[:2]
    return cv2.warpAffine(im, M, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))


def ellipse_mask(shape, center, radii, feather) -> np.ndarray:
    """Float mask: 1 inside the ellipse, fading to 0 over `feather` pixels."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = center
    rx, ry = radii
    r = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
    edge = feather / max(rx, ry)
    return np.clip((1 - r) / edge, 0, 1)


def poly_mask(shape, poly, grow=5, feather=2.5) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.int32(poly)], 255)
    if grow:
        m = cv2.dilate(m, np.ones((grow * 2 + 1, grow * 2 + 1), np.uint8))
    return cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), feather)


def inpaint(im: np.ndarray, region: np.ndarray) -> np.ndarray:
    """Fills `region` (bool) of an RGBA image from its surroundings, colour and alpha."""
    mask = region.astype(np.uint8) * 255
    out = im.copy()
    rgb = cv2.inpaint(np.ascontiguousarray(im[..., :3]), mask, 9, cv2.INPAINT_TELEA)
    alpha = cv2.inpaint(np.ascontiguousarray(im[..., 3]), mask, 9, cv2.INPAINT_TELEA)
    out[..., :3][region] = rgb[region]
    out[..., 3][region] = alpha[region]
    return out


def inpaint_texture(im: np.ndarray, region: np.ndarray, pad: int = 40) -> np.ndarray:
    """Fills `region` with texture-aware inpainting (OpenCV xphoto FSR), colour and alpha.

    Slower than inpaint() but continues edges and fabric texture, so it is used
    where a moving part uncovers the body in plain view.
    """
    ys, xs = np.nonzero(region)
    h, w = region.shape
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(w, xs.max() + pad), min(h, ys.max() + pad)
    sub = im[y0:y1, x0:x1]
    reg = region[y0:y1, x0:x1]
    valid = (~reg).astype(np.uint8) * 255
    # Premultiplied colour so transparent surroundings read as empty, not as colour.
    a = sub[..., 3:4].astype(np.float32) / 255
    rgb = np.ascontiguousarray((sub[..., :3] * a).astype(np.uint8))
    alpha3 = np.ascontiguousarray(np.repeat(sub[..., 3:4], 3, axis=2))
    rgb_out = np.zeros_like(rgb)
    alpha_out = np.zeros_like(alpha3)
    cv2.xphoto.inpaint(rgb, valid, rgb_out, cv2.xphoto.INPAINT_FSR_BEST)
    cv2.xphoto.inpaint(alpha3, valid, alpha_out, cv2.xphoto.INPAINT_FSR_FAST)
    fa = alpha_out[..., 0].astype(np.float32)
    fa[fa < 40] = 0
    un = np.clip(rgb_out.astype(np.float32) * 255 / np.maximum(fa[..., None], 1), 0, 255).astype(np.uint8)
    out = im.copy()
    out[y0:y1, x0:x1, :3][reg] = un[reg]
    out[y0:y1, x0:x1, 3][reg] = fa.astype(np.uint8)[reg]
    return out


def with_alpha(im: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = im.copy()
    out[..., 3] = (im[..., 3].astype(np.float32) * mask).astype(np.uint8)
    return out


def garment_mask(before: np.ndarray, after: np.ndarray, box=None, close=11, min_area=1500) -> np.ndarray:
    """Pixels of `before` that change in `after`: the garment that comes off."""
    a = before.astype(np.int16)
    b = after.astype(np.int16)
    diff = np.abs(a[..., :3] - b[..., :3]).sum(2)
    gone = (a[..., 3] > 128) & (b[..., 3] < 64)
    hsv = cv2.cvtColor(np.ascontiguousarray(before[..., :3]), cv2.COLOR_RGB2HSV)
    h, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # Skin that merely shifted between redraws is body, not garment.
    skin = (h >= 4) & (h <= 22) & (sat > 25) & (sat < 150) & (val > 140)
    m = ((((diff > 90) & (a[..., 3] > 128)) | gone) & ~skin).astype(np.uint8) * 255
    if box:
        x0, y0, x1, y1 = box
        zone = np.zeros_like(m)
        zone[y0:y1, x0:x1] = 255
        m &= zone
    # Thin outlines where the redraw shifted an edge are not garments.
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close)))
    # Closing can bridge onto skin or background; keep only clothed, visible pixels.
    m &= ((~skin) & (a[..., 3] > 128)).astype(np.uint8) * 255
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] > min_area:
            keep[lab == i] = 255
    keep = cv2.dilate(keep, np.ones((3, 3), np.uint8))
    return cv2.GaussianBlur(keep.astype(np.float32) / 255, (0, 0), 1.2)


def garment_poly_mask(before: np.ndarray, poly, after: np.ndarray | None = None) -> np.ndarray:
    """A garment outlined by hand: the visible pixels inside `poly` that are not
    skin or, when `after` is given, that change in the next stage (for gold
    accessories, which read as skin tones)."""
    if after is None:
        hsv = cv2.cvtColor(np.ascontiguousarray(before[..., :3]), cv2.COLOR_RGB2HSV)
        h, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
        keep = ~((h >= 4) & (h <= 22) & (sat > 25) & (sat < 150) & (val > 140))
    else:
        keep = np.abs(before[..., :3].astype(np.int16) - after[..., :3]).sum(2) > 60
    m = np.zeros(before.shape[:2], np.uint8)
    cv2.fillPoly(m, [np.int32(poly)], 255)
    m &= (keep & (before[..., 3] > 128)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if after is not None:
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    return cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 1.2)


def hexc(rgb) -> str:
    return '#%02x%02x%02x' % tuple(int(v) for v in rgb[:3])


def median_color(im: np.ndarray, box) -> str:
    x0, y0, x1, y1 = box
    px = im[y0:y1, x0:x1, :3].reshape(-1, 3)
    px = px[np.argsort(px.sum(1))]
    return hexc(px[len(px) // 2])


def darkest_color(im: np.ndarray, box) -> str:
    x0, y0, x1, y1 = box
    px = im[y0:y1, x0:x1, :3].reshape(-1, 3)
    px = px[np.argsort(px.sum(1))]
    return hexc(px[: max(1, len(px) // 40)].mean(0))


def face_meta(im: np.ndarray, f: dict) -> dict:
    out = {k: f[k] for k in ('center', 'cheekIn', 'headTop', 'cheeks')}
    out['eyes'] = []
    for x, y, w, angle in f['eyes']:
        # Lid colour from the skin just under the eye; lash colour from the eye's darkest ink.
        skin = median_color(im, (x - w // 3, y + w // 2, x + w // 3, y + w // 2 + 6))
        lash = darkest_color(im, (x - w // 2, y - w // 2, x + w // 2, y + w // 4))
        out['eyes'].append({'x': x, 'y': y, 'w': w, 'angle': angle, 'skin': skin, 'lash': lash})
    x, y, w, angle = f['mouth']
    out['mouth'] = {
        'x': x, 'y': y, 'w': w, 'angle': angle,
        'skin': median_color(im, (x - w, y - 16, x + w, y - 10)),
        'lip': darkest_color(im, (x - w // 2, y - 4, x + w // 2, y + 4)),
    }
    return out


def save_part(cid: str, name: str, im: np.ndarray, crop, parts: list, **extra):
    """Crops to the visible pixels, writes a WebP and records the part."""
    x0, y0, x1, y1 = crop
    region = im[y0:y1, x0:x1]
    ys, xs = np.nonzero(region[..., 3] > 0)
    if len(xs) == 0:
        return
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    tile = region[by0:by1, bx0:bx1]
    path = OUT / cid / f'{name}.webp'
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(tile, 'RGBA').save(path, 'WEBP', quality=90, method=6)
    parts.append({'name': name, 'file': f'{name}.webp', 'x': int(x0 + bx0), 'y': int(y0 + by0), 'w': int(bx1 - bx0), 'h': int(by1 - by0), **extra})


# ------------------------------------------------------------------ build

def build(cid: str, lay: dict, recut: bool):
    variants = lay['variants']
    images = []
    for i, name in enumerate(variants):
        im = cutout(name, recut)
        images.append(im if i == 0 else align(variants[0], name, im))

    shape = images[0].shape[:2]
    hd = lay['head']
    head_m = ellipse_mask(shape, hd['center'], hd['radii'], hd['feather'])
    head_fill = ellipse_mask(shape, hd['center'], [r - hd['feather'] for r in hd['radii']], 1) > 0.5
    fa = lay['forearm']
    fore_m = poly_mask(shape, fa['poly'])
    fore_fill = poly_mask(shape, fa['poly'], grow=8, feather=0.1) > 0.02

    parts: list = []
    multi = len(images) > 1
    for stage, im in enumerate(images):
        sfx = f'.s{stage}' if multi else ''
        vis = {'stages': [stage]} if multi else {}
        # Body: head and forearm areas filled in so moving parts reveal no holes.
        body = inpaint_texture(inpaint(im, head_fill), fore_fill)
        save_part(cid, f'body{sfx}', body, lay['crop'], parts, z=0, **vis)
        save_part(cid, f'head{sfx}', with_alpha(im, head_m), lay['crop'], parts,
                  z=40, parent=f'body{sfx}', pivot=hd['pivot'], drive='head', **vis)
        save_part(cid, f'forearm{sfx}', with_alpha(im, fore_m), lay['crop'], parts,
                  z=50, parent=f'body{sfx}', pivot=fa['pivot'], drive='nearFore', **vis)
        # The garment that comes off at the next milestone, cut from this stage.
        if multi and stage + 1 < len(images):
            layer = SELL_LAYERS[stage]
            poly = lay.get('garmentPolys', {}).get(layer)
            by_diff = layer in lay.get('garmentPolyByDiff', [])
            g = garment_poly_mask(im, poly, images[stage + 1] if by_diff else None) if poly else garment_mask(
                im, images[stage + 1],
                lay.get('garmentZones', {}).get(layer),
                lay.get('garmentClose', {}).get(layer, 11),
                lay.get('garmentMinArea', {}).get(layer, 1500),
            )
            # Garments never include the moving head or forearm.
            g = g * (1 - head_m) * (1 - fore_m)
            save_part(cid, f'garment.{SELL_LAYERS[stage]}', with_alpha(im, g), lay['crop'], parts,
                      z=45, parent=f'body{sfx}', garment=SELL_LAYERS[stage], **vis)

    meta = {
        'sources': [f'art/source/{v}.png' for v in variants],
        'hip': lay['hip'],
        'stages': len(images),
        'parts': parts,
        'face': face_meta(images[0], lay['face']),
    }
    (OUT / f'{cid}.json').write_text(json.dumps(meta, indent=1))
    for p in parts:
        print(cid, p['name'], p['w'], 'x', p['h'])


def main():
    recut = '--recut' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    for cid, lay in LAYOUT.items():
        if not only or cid in only:
            build(cid, lay, recut)


if __name__ == '__main__':
    main()
