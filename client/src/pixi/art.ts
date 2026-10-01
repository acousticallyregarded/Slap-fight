// Code-drawn, cel-shaded placeholder art for both characters.
// Every part is a flat base colour, clipped shadow/highlight bands, and an ink
// outline, which is how anime cel art is layered. Each builder returns a
// Container so the part can be swapped for a textured sprite (docs/ASSETS.md).
import { Container, Graphics } from 'pixi.js';
import { celPart, grad, mirrorPath, path, strand } from './draw';
import type { Brows, HandShape, Mouth } from './pose';
import type { CharacterStyle } from './styles';

export const NECK_Y = -326;
export const SHOULDER = { x: 74, y: -282 };
export const UPPER = 134;
export const FORE = 122;

const WHITE = '#ffffff';

// ------------------------------------------------------------------ body

const torsoShape = (g: Graphics) =>
  mirrorPath(g, [0, -300], [
    { to: [18, -300] },
    { to: [74, -288], c: [44, -298] },
    { to: [92, -258], c: [94, -284] },
    { to: [86, -244] },
    { to: [98, -198], c: [106, -226] },
    { to: [64, -168], c: [94, -174] },
    { to: [52, -120], c: [51, -148] },
    { to: [98, -22], c: [55, -66] },
    { to: [102, 40], c: [108, 4] },
    { to: [0, 44] },
  ]);

const TORSO_SIDE: [number, number, number, number][] = [
  [74, -288, 44, -298], [92, -258, 94, -284], [86, -244, 90, -251], [98, -198, 106, -226], [64, -168, 94, -174],
  [52, -120, 51, -148], [98, -22, 55, -66], [102, 30, 108, 4],
];
function torsoSide(g: Graphics, side: 1 | -1) {
  g.moveTo(side * 18, -300);
  for (const [x, y, cx, cy] of TORSO_SIDE) g.quadraticCurveTo(side * cx, cy, side * x, y);
}

export function torso(s: CharacterStyle) {
  const neck = celPart({
    shape: (g) => path(g, [-17, NECK_Y - 6], [{ to: [17, NECK_Y - 6] }, { to: [20, -296] }, { to: [-20, -296] }]),
    base: { color: s.skin },
    shade: (g) => {
      g.ellipse(0, NECK_Y + 4, 26, 16).fill({ color: s.skinShade });
      g.rect(-24, NECK_Y, 12, 50).fill({ color: s.skinShade });
    },
  });
  const body = celPart({
    shape: torsoShape,
    base: { color: s.skin },
    line: s.skinLine,
    lineWidth: 2,
    // Ink the sides only, so the hips blend into the legs without a seam.
    lineShape: (g) => {
      torsoSide(g, 1);
      torsoSide(g, -1);
    },
    shade: (g) => {
      // Form shadow down the far side, following the silhouette.
      path(g, [-140, -320], [
        { to: [-62, -292] },
        { to: [-74, -248], c: [-60, -270] },
        { to: [-80, -196], c: [-86, -222] },
        { to: [-44, -150], c: [-58, -168] },
        { to: [-38, -110], c: [-36, -130] },
        { to: [-80, -18], c: [-44, -60] },
        { to: [-84, 44], c: [-90, 10] },
        { to: [-140, 44] },
      ]).fill({ color: s.skinShade });
      // Shadow cast by the head onto the chest.
      g.ellipse(0, -300, 34, 14).fill({ color: s.skinShade, alpha: 0.8 });
      // Soft abdomen modelling.
      g.moveTo(0, -150).quadraticCurveTo(3, -120, 0, -92).stroke({ width: 2, color: s.skinDeep, alpha: 0.35 });
      g.ellipse(0, -76, 2.6, 4.5).fill({ color: s.skinDeep, alpha: 0.7 });
      for (const side of [1, -1]) {
        g.moveTo(side * 58, -290).quadraticCurveTo(side * 32, -282, side * 10, -290).stroke({ width: 2.2, color: s.skinDeep, alpha: 0.55 });
        g.moveTo(side * 36, -126).quadraticCurveTo(side * 30, -100, side * 38, -70).stroke({ width: 2, color: s.skinDeep, alpha: 0.18 });
      }
      // Rim light on the lit side.
      g.moveTo(92, -250).quadraticCurveTo(58, -140, 96, -24).stroke({ width: 5, color: WHITE, alpha: 0.12 });
    },
  });
  const c = new Container();
  c.addChild(neck, body);
  return c;
}

export function legs(s: CharacterStyle) {
  const c = new Container();
  for (const side of [1, -1] as const) {
    const X = (x: number) => side * x;
    const shape = (g: Graphics) =>
      path(g, [X(100), -4], [
        { to: [X(96), 120], c: [X(112), 60] },
        { to: [X(70), 214], c: [X(84), 180] },
        { to: [X(76), 300], c: [X(84), 256] },
        { to: [X(52), 420], c: [X(66), 360] },
        { to: [X(28), 420] },
        { to: [X(20), 300], c: [X(16), 360] },
        { to: [X(24), 214], c: [X(16), 260] },
        { to: [X(4), 44], c: [X(10), 110] },
      ]);
    c.addChild(
      celPart({
        shape,
        base: { color: s.skin },
        line: s.skinLine,
        lineWidth: 2,
        shade: (g) => {
          // Outer form shadow following the thigh and calf contour.
          const o = side === 1 ? 0 : 1;
          path(g, [X(130), -10], [
            { to: [X(84), 0] },
            { to: [X(82), 120], c: [X(94), 60] },
            { to: [X(58), 214], c: [X(72), 180] },
            { to: [X(62), 300], c: [X(70), 256] },
            { to: [X(42), 430], c: [X(54), 360] },
            { to: [X(130), 430] },
          ]).fill({ color: s.skinShade, alpha: o ? 1 : 0.55 });
          // Inner thigh shadow and knee.
          g.ellipse(X(14), 60, 16, 48).fill({ color: s.skinShade, alpha: 0.7 });
          g.moveTo(X(40), 206).quadraticCurveTo(X(50), 214, X(60), 206).stroke({ width: 2, color: s.skinDeep, alpha: 0.45 });
          // Highlight down the front of the thigh.
          g.moveTo(X(52), 20).quadraticCurveTo(X(58), 110, X(44), 196).stroke({ width: 9, color: WHITE, alpha: 0.14, cap: 'round' });
        },
      }),
    );
  }
  return c;
}

export function armParts(s: CharacterStyle, side: 1 | -1) {
  const shadeSide = side === 1 ? -1 : 1; // shadow on the inner side
  const upper = celPart({
    shape: (g) => limbPath(g, UPPER, 35, 27, 3),
    base: { color: s.skin },
    line: s.skinLine,
    lineWidth: 1.8,
    shade: (g) => g.rect(shadeSide > 0 ? 4 : -30, -20, 26, UPPER + 40).fill({ color: s.skinShade }),
  });
  const fore = celPart({
    shape: (g) => limbPath(g, FORE, 27, 19, 2),
    base: { color: s.skin },
    line: s.skinLine,
    lineWidth: 1.8,
    shade: (g) => g.rect(shadeSide > 0 ? 3 : -22, -20, 19, FORE + 30).fill({ color: s.skinShade }),
  });
  return { upper, fore };
}

function limbPath(g: Graphics, len: number, w0: number, w1: number, bulge: number) {
  const h0 = w0 / 2;
  const h1 = w1 / 2;
  g.moveTo(-h0, 0);
  g.quadraticCurveTo(-h0 - bulge, len * 0.4, -h1, len);
  g.quadraticCurveTo(0, len + h1 * 1.1, h1, len);
  g.quadraticCurveTo(h0 + bulge, len * 0.4, h0, 0);
  g.quadraticCurveTo(0, -h0 * 1.1, -h0, 0);
  g.closePath();
  return g;
}

export function hand(s: CharacterStyle, shape: HandShape) {
  const c = new Container();
  const ink = { width: 1.6, color: s.skinLine, alpha: 0.85 };
  const nail = s.id === 'buy' ? '#34d399' : '#e11d48';
  const finger = (x: number, len: number, angle = 0, w = 7) => {
    const g = new Graphics();
    g.roundRect(-w / 2, 0, w, len, w / 2).fill({ color: s.skin }).stroke(ink);
    g.roundRect(-w / 2 + 1.2, len - 6.5, w - 2.4, 5.5, 2.5).fill({ color: nail });
    g.position.set(x, 16);
    g.rotation = angle;
    c.addChild(g);
  };
  const palm = (closed = false) => {
    const g = new Graphics();
    g.roundRect(-12, -2, 24, closed ? 30 : 26, 10).fill({ color: s.skin }).stroke(ink);
    g.roundRect(-12, -2, 9, closed ? 30 : 26, 6).fill({ color: s.skinShade, alpha: 0.6 });
    c.addChild(g);
    if (closed) {
      g.moveTo(-8, 21).lineTo(8, 21).stroke({ ...ink, alpha: 0.4 });
      g.moveTo(-8, 12).lineTo(8, 12).stroke({ ...ink, alpha: 0.3 });
    }
  };
  if (shape === 'open') {
    palm();
    finger(-8, 24, 0.14, 6.4);
    finger(-2.5, 28, 0.04, 6.6);
    finger(3, 27, -0.04, 6.6);
    finger(8.5, 22, -0.14, 6);
    finger(12, 16, -0.95, 7);
  } else if (shape === 'relaxed') {
    // Fingers held together and softly curled, the way anime hands rest.
    const g = new Graphics();
    const outline = (h: Graphics) =>
      path(h, [-12, -2], [
        { to: [12, -2], c: [0, -6] },
        { to: [14, 22], c: [15, 8] },
        { to: [10, 44], c: [15, 36] },
        { to: [0, 50], c: [6, 50] },
        { to: [-10, 42], c: [-8, 48] },
        { to: [-13, 20], c: [-14, 30] },
      ]);
    outline(g).fill({ color: s.skin });
    g.moveTo(-12, 4).quadraticCurveTo(-14, 26, -8, 42).lineTo(-3, 44).quadraticCurveTo(-8, 24, -6, 4).closePath().fill({ color: s.skinShade, alpha: 0.7 });
    for (const [x0, x1] of [[-4, -3], [1.5, 2.5], [6.5, 7]]) g.moveTo(x0, 24).quadraticCurveTo(x0 + 0.5, 36, x1, 46).stroke({ ...ink, alpha: 0.45, width: 1.2 });
    outline(g).stroke(ink);
    for (const [x, y] of [[-6, 44], [-1, 47.5], [4.5, 47], [9, 42]]) g.ellipse(x, y, 2.3, 2).fill({ color: nail });
    // Thumb along the front.
    g.moveTo(12, 6).quadraticCurveTo(20, 18, 14, 30).quadraticCurveTo(10, 24, 9, 14).closePath().fill({ color: s.skin }).stroke(ink);
    c.addChild(g);
  } else if (shape === 'fist') {
    palm(true);
  } else if (shape === 'peace') {
    palm(true);
    finger(-4.5, 32, 0.2, 6.6);
    finger(4, 32, -0.2, 6.6);
  } else if (shape === 'point') {
    palm(true);
    finger(2, 32, 0, 6.6);
  }
  return c;
}

// ------------------------------------------------------------------ head
// Head-local coordinates: chin at (0,-2), crown at (0,-150), face half-width 54.

const faceShape = (g: Graphics) =>
  mirrorPath(g, [0, 0], [
    { to: [30, -22], c: [14, -4] },
    { to: [55, -76], c: [52, -40] },
    { to: [0, -150], c: [58, -148] },
  ]);

export function face(s: CharacterStyle) {
  const c = new Container();
  const ears = new Graphics();
  for (const x of [-52, 52]) {
    ears.ellipse(x, -70, 7, 13).fill({ color: s.skin }).stroke({ width: 1.6, color: s.skinLine });
    ears.ellipse(x, -70, 3, 7).fill({ color: s.skinShade });
  }
  c.addChild(ears);
  c.addChild(
    celPart({
      shape: faceShape,
      base: { color: s.skin },
      line: s.skinLine,
      lineWidth: 1.8,
      shade: (g) => {
        // Hair casts a jagged shadow across the forehead.
        g.moveTo(-60, -160).lineTo(60, -160).lineTo(60, -104);
        for (let x = 52; x >= -60; x -= 14) g.lineTo(x - 7, -96 - ((x * 7) % 9)).lineTo(x - 14, -106);
        g.closePath().fill({ color: s.skinShade });
        // Far cheek and jaw.
        path(g, [-60, -100], [
          { to: [-40, -60], c: [-44, -86] },
          { to: [-24, -8], c: [-38, -30] },
          { to: [-60, 0] },
        ]).fill({ color: s.skinShade });
        // Warm cheek tint (always on, subtle).
        g.ellipse(30, -46, 12, 6).fill({ color: '#ff8fa3', alpha: s.blushBase });
        g.ellipse(-28, -46, 10, 5).fill({ color: '#ff8fa3', alpha: s.blushBase });
      },
    }),
  );
  // Earrings.
  const jewel = new Graphics();
  for (const x of [-52, 52]) {
    jewel.circle(x, -56, 2.6).fill({ color: '#f5c451' });
    jewel.moveTo(x, -56).lineTo(x, -42).stroke({ width: 1.4, color: '#f5c451' });
    jewel
      .moveTo(x, -42)
      .lineTo(x + 4.5, -34)
      .lineTo(x, -24)
      .lineTo(x - 4.5, -34)
      .closePath()
      .fill({ color: s.id === 'buy' ? '#34d399' : '#c084fc' })
      .stroke({ width: 1.2, color: '#f5c451' });
  }
  c.addChild(jewel);
  return c;
}

/** One eye, drawn for the right side (outer corner at +x). The left eye is mirrored by the rig. */
export function eye(s: CharacterStyle) {
  const root = new Container();
  const open = new Container();
  const sclera = (g: Graphics) =>
    g.moveTo(-14, 5).quadraticCurveTo(-13, -11, 1, -13).quadraticCurveTo(14, -13, 19, -4).quadraticCurveTo(14, 9, 1, 10).quadraticCurveTo(-9, 10, -14, 5).closePath();
  const white = sclera(new Graphics()).fill({ color: '#fbf8ff' });
  const irisWrap = new Container();
  const iris = new Container();
  const ig = new Graphics();
  ig.ellipse(0, 0, 10.5, 14).fill(grad([[0, s.irisDark], [0.45, s.iris], [1, '#ffffff']]));
  ig.ellipse(0, -4, 10.5, 9).fill({ color: s.irisDark, alpha: 0.55 });
  ig.ellipse(0, 0, 10.5, 14).stroke({ width: 1.4, color: s.irisDark });
  ig.ellipse(0, 1, 4.6, 6.4).fill({ color: '#140a1c' });
  ig.ellipse(0, 6.5, 6, 3).fill({ color: s.iris, alpha: 0.7 });
  ig.ellipse(-4, -5.5, 3.6, 4.8).fill({ color: WHITE });
  ig.circle(4.5, 4.5, 1.8).fill({ color: WHITE, alpha: 0.95 });
  ig.circle(-6, 5, 1).fill({ color: WHITE, alpha: 0.8 });
  iris.addChild(ig);
  const lidShadow = new Graphics().rect(-20, -16, 44, 7).fill({ color: '#6b5a8a', alpha: 0.28 });
  const mask = sclera(new Graphics()).fill({ color: 0xffffff });
  irisWrap.addChild(iris, lidShadow, mask);
  irisWrap.mask = mask;
  const lash = new Graphics();
  // Thick upper lash line with a flicked outer corner.
  lash
    .moveTo(-16, 5)
    .quadraticCurveTo(-15, -13, 1, -15.5)
    .quadraticCurveTo(15, -16, 21, -6)
    .lineTo(26, -11)
    .lineTo(22, -2)
    .quadraticCurveTo(15, -11, 1, -11.5)
    .quadraticCurveTo(-11, -11, -14, 4)
    .closePath()
    .fill({ color: s.line });
  lash.moveTo(18, -9).lineTo(24, -16).stroke({ width: 2, color: s.line, cap: 'round' });
  lash.moveTo(-7, 10).quadraticCurveTo(5, 12, 15, 6).stroke({ width: 1.3, color: s.line, alpha: 0.7 });
  // Crease and eyeshadow.
  lash.moveTo(-11, -19).quadraticCurveTo(4, -23, 17, -16).stroke({ width: 1.4, color: s.skinLine, alpha: 0.75 });
  lash.moveTo(-8, -16).quadraticCurveTo(4, -20, 16, -13).stroke({ width: 5, color: s.eyeshadow, alpha: 0.22 });
  open.addChild(white, irisWrap, lash);
  const happy = new Graphics().moveTo(-13, 2).quadraticCurveTo(2, -13, 18, 1).stroke({ width: 3.4, color: s.line, cap: 'round' });
  happy.moveTo(18, 1).lineTo(22, -3).stroke({ width: 2, color: s.line, cap: 'round' });
  const wince = new Graphics().moveTo(-12, -8).lineTo(12, -1).lineTo(-12, 6).stroke({ width: 3.4, color: s.line, cap: 'round', join: 'round' });
  const closed = new Graphics().moveTo(-14, -1).quadraticCurveTo(2, 6, 19, -2).stroke({ width: 3.2, color: s.line, cap: 'round' });
  closed.moveTo(19, -2).lineTo(23, 1).stroke({ width: 2, color: s.line, cap: 'round' });
  root.addChild(open, happy, wince, closed);
  return { root, open, iris, happy, wince, closed };
}

export function drawBrow(g: Graphics, s: CharacterStyle, mode: Brows, side: 1 | -1) {
  g.clear();
  let inner = -96;
  let outer = -97;
  let arch = -104;
  if (mode === 'up') (inner = -104), (outer = -103), (arch = -112);
  if (mode === 'angry') (inner = -88), (outer = -102), (arch = -100);
  if (mode === 'worried') (inner = -104), (outer = -93), (arch = -104);
  if (mode === 'smug' && side === 1) (inner = -97), (outer = -106), (arch = -110);
  // Tapered brow: thick at the inner end.
  g.moveTo(side * 8, inner - 2)
    .quadraticCurveTo(side * 24, arch - 2, side * 40, outer)
    .quadraticCurveTo(side * 24, arch + 2.5, side * 8, inner + 2.5)
    .closePath()
    .fill({ color: s.hairShade });
}

export function drawMouth(g: Graphics, s: CharacterStyle, m: Mouth) {
  g.clear();
  const y = -30;
  const lip = { width: 2.2, color: s.lip, cap: 'round' as const };
  const dark = '#4a1422';
  const lower = (w: number, dy = 5) => g.moveTo(-w, y + dy).quadraticCurveTo(0, y + dy + 4, w, y + dy).stroke({ width: 2.6, color: s.lip, alpha: 0.45, cap: 'round' });
  switch (m) {
    case 'smile':
      g.moveTo(-12, y - 1).quadraticCurveTo(0, y + 6, 12, y - 2).stroke(lip);
      lower(5, 5);
      break;
    case 'smug':
      g.moveTo(-9, y + 1).quadraticCurveTo(3, y + 4, 13, y - 5).stroke(lip);
      lower(4, 5);
      break;
    case 'flat':
      g.moveTo(-8, y).lineTo(8, y).stroke(lip);
      lower(4, 4);
      break;
    case 'pout':
      g.moveTo(-7, y + 1).quadraticCurveTo(0, y - 3, 7, y + 1).stroke(lip);
      g.ellipse(0, y + 4, 5, 2.4).fill({ color: s.lip, alpha: 0.5 });
      break;
    case 'kiss':
      g.ellipse(2, y, 4.5, 5).fill({ color: s.lip });
      g.ellipse(1, y - 1.5, 1.6, 1.2).fill({ color: WHITE, alpha: 0.6 });
      break;
    case 'grin':
      g.moveTo(-14, y - 3).quadraticCurveTo(0, y - 1, 14, y - 3).quadraticCurveTo(0, y + 13, -14, y - 3).fill({ color: dark });
      g.moveTo(-12, y - 2).quadraticCurveTo(0, y, 12, y - 2).lineTo(11, y + 1.5).quadraticCurveTo(0, y + 3.5, -11, y + 1.5).fill({ color: WHITE });
      g.ellipse(0, y + 6, 6, 2.6).fill({ color: '#e56b7f' });
      g.moveTo(-14, y - 3).quadraticCurveTo(0, y + 13, 14, y - 3).stroke({ ...lip, width: 1.6 });
      break;
    case 'laugh':
      g.moveTo(-15, y - 6).quadraticCurveTo(0, y - 4, 15, y - 6).quadraticCurveTo(0, y + 18, -15, y - 6).fill({ color: dark });
      g.ellipse(0, y + 7, 7.5, 4).fill({ color: '#e56b7f' });
      g.moveTo(-13, y - 5).quadraticCurveTo(0, y - 3, 13, y - 5).lineTo(12, y - 1.5).quadraticCurveTo(0, y + 0.5, -12, y - 1.5).fill({ color: WHITE });
      break;
    case 'open':
      g.ellipse(0, y + 2, 8.5, 7.5).fill({ color: dark }).stroke({ width: 1.4, color: s.lip });
      g.ellipse(0, y + 5.5, 5, 2.6).fill({ color: '#e56b7f' });
      break;
    case 'o':
      g.ellipse(0, y + 2, 5.5, 7).fill({ color: dark }).stroke({ width: 1.6, color: s.lip });
      break;
    case 'grit':
      g.roundRect(-12, y - 4, 24, 10, 4).fill({ color: WHITE }).stroke({ width: 1.8, color: s.lip });
      g.moveTo(-12, y + 1).lineTo(12, y + 1).stroke({ width: 1, color: '#c9a9b0' });
      break;
  }
}

export function nose(s: CharacterStyle) {
  const g = new Graphics();
  g.moveTo(4, -50).lineTo(1, -44).lineTo(4, -43).stroke({ width: 1.6, color: s.skinLine, alpha: 0.6, cap: 'round', join: 'round' });
  return g;
}

export function blush() {
  const g = new Graphics();
  for (const x of [-30, 32]) {
    g.ellipse(x, -44, 14, 6.5).fill({ color: '#ff5f86', alpha: 0.5 });
    for (let i = -1; i <= 1; i++) g.moveTo(x + i * 6 - 2, -41).lineTo(x + i * 6 + 2, -47).stroke({ width: 1.4, color: '#d93a64', alpha: 0.8 });
  }
  return g;
}

// ------------------------------------------------------------------ hair

function hairPart(s: CharacterStyle, draw: (g: Graphics) => void, opts: { highlightY?: number; dark?: boolean; strands?: number; top?: number; bottom?: number } = {}) {
  const top = opts.top ?? -170;
  const bottom = opts.bottom ?? 240;
  return celPart({
    shape: draw,
    base: grad([[0, s.hair], [0.55, opts.dark ? s.hairShade : s.hair], [1, s.hairTip]]),
    line: s.hairInk,
    lineWidth: 2,
    shade: (g) => {
      // A few irregular strand lines, as an illustrator would ink them.
      const n = opts.strands ?? 7;
      for (let i = 0; i < n; i++) {
        const x = -120 + (240 / (n - 1)) * i + (((i * 37) % 11) - 5) * 2;
        const bow = ((i * 53) % 17) - 8;
        g.moveTo(x * 0.55, top + ((i * 29) % 30)).quadraticCurveTo(x + bow * 2, (top + bottom) / 2, x * 1.1 + bow, bottom - ((i * 41) % 60))
          .stroke({ width: 2.2, color: s.hairShade, alpha: 0.55, cap: 'round' });
      }
      if (opts.highlightY !== undefined) {
        const y = opts.highlightY;
        g.moveTo(-64, y + 4);
        for (let x = -64; x < 64; x += 16) g.quadraticCurveTo(x + 8, y - 12, x + 16, y + 2);
        for (let x = 64; x > -64; x -= 16) g.lineTo(x - 8, y + 10 + ((x * 3) % 5)).lineTo(x - 16, y + 5);
        g.closePath().fill({ color: s.hairLight, alpha: 0.6 });
      }
    },
  });
}

/** Hair behind the head and body. Head-local coordinates. */
export function backHair(s: CharacterStyle) {
  const c = new Container();
  if (s.hairStyle === 'long') {
    c.addChild(
      hairPart(
        s,
        (g) => {
          g.moveTo(0, -164);
          g.quadraticCurveTo(76, -164, 78, -90);
          g.quadraticCurveTo(96, 40, 124, 170);
          // Wavy, strand-cut ends.
          const tips: [number, number][] = [[112, 214], [96, 196], [80, 226], [60, 204], [40, 232], [18, 210], [0, 230]];
          for (const t of tips) g.lineTo(t[0], t[1]);
          for (const t of [...tips].reverse().slice(1)) g.lineTo(-t[0], t[1]);
          g.lineTo(-124, 170);
          g.quadraticCurveTo(-96, 40, -78, -90);
          g.quadraticCurveTo(-76, -164, 0, -164);
          g.closePath();
        },
        { dark: true },
      ),
    );
  } else {
    c.addChild(
      hairPart(
        s,
        (g) => {
          g.moveTo(0, -164);
          g.quadraticCurveTo(72, -164, 72, -90);
          g.quadraticCurveTo(80, 0, 64, 40);
          for (const t of [[48, 30], [30, 48], [10, 36], [-10, 48], [-30, 34], [-48, 46], [-64, 40]] as [number, number][]) g.lineTo(t[0], t[1]);
          g.quadraticCurveTo(-80, 0, -72, -90);
          g.quadraticCurveTo(-72, -164, 0, -164);
          g.closePath();
        },
        { dark: true },
      ),
    );
    // High ponytail swinging behind the far shoulder.
    const tail = new Container();
    tail.label = 'ponytail';
    tail.addChild(
      hairPart(s, (g) => {
        g.moveTo(-6, 0);
        g.quadraticCurveTo(-76, 0, -96, 90);
        g.quadraticCurveTo(-128, 210, -104, 330);
        g.lineTo(-92, 296).lineTo(-80, 340).lineTo(-72, 290).lineTo(-58, 318);
        g.quadraticCurveTo(-56, 200, -40, 110);
        g.quadraticCurveTo(-24, 40, 12, 12);
        g.closePath();
      }),
    );
    const tie = new Graphics().roundRect(-18, -9, 32, 18, 7).fill({ color: '#f5c451' }).stroke({ width: 2, color: '#a4761f' });
    tie.position.set(-2, 0);
    tail.addChild(tie);
    tail.position.set(-14, -150);
    tail.scale.set(1.15);
    c.addChild(tail);
  }
  return c;
}

type Pt = [number, number];

/** A pointed hair clump: two root points on the hairline and a tip, sides bowed by `curve`. */
function clump(g: Graphics, l: Pt, r: Pt, tip: Pt, curve = 0) {
  const c1: Pt = [(l[0] + tip[0]) / 2 - curve, (l[1] + tip[1]) / 2];
  const c2: Pt = [(r[0] + tip[0]) / 2 - curve * 0.6, (r[1] + tip[1]) / 2];
  g.moveTo(l[0], l[1]).quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]).quadraticCurveTo(c2[0], c2[1], r[0], r[1]).closePath();
  return g;
}

function hairClump(s: CharacterStyle, l: Pt, r: Pt, tip: Pt, curve: number) {
  return celPart({
    shape: (g) => clump(g, l, r, tip, curve),
    base: grad([[0, s.hair], [0.75, s.hair], [1, s.hairShade]]),
    line: s.hairInk,
    lineWidth: 1.8,
    shade: (g) => {
      // Inner shadow down one side of the clump and a glossy band across it.
      clump(g, [l[0] + (r[0] - l[0]) * 0.55, l[1]], r, [tip[0] + (r[0] - l[0]) * 0.1, tip[1] - 6], curve * 0.6).fill({ color: s.hairShade, alpha: 0.55 });
      // Gloss follows one arc across every clump so it reads as a continuous ring.
      g.moveTo(-100, -142).quadraticCurveTo(0, -178, 100, -142).lineTo(100, -134).quadraticCurveTo(0, -168, -100, -134).closePath().fill({ color: s.hairLight, alpha: 0.6 });
    },
  });
}

/** Cranium, fringe clumps and side locks in front of the face. */
export function frontHair(s: CharacterStyle) {
  const c = new Container();
  // Cranium: hair volume wider than the face, framing the temples.
  c.addChild(
    celPart({
      shape: (g) => {
        g.moveTo(-76, -40);
        g.quadraticCurveTo(-92, -196, 0, -194);
        g.quadraticCurveTo(92, -196, 76, -40);
        g.quadraticCurveTo(66, -120, 52, -140);
        g.quadraticCurveTo(0, -150, -52, -140);
        g.quadraticCurveTo(-66, -120, -76, -40);
        g.closePath();
      },
      base: grad([[0, s.hairLight], [0.18, s.hair], [1, s.hairShade]]),
      line: s.hairInk,
      lineWidth: 2,
      shade: (g) => {
        g.moveTo(-70, -150).quadraticCurveTo(0, -196, 70, -150).lineTo(70, -140).quadraticCurveTo(0, -182, -70, -140).closePath().fill({ color: s.hairLight, alpha: 0.5 });
        for (const x of [-60, -30, 30, 60]) g.moveTo(x * 0.3, -192).quadraticCurveTo(x, -170, x * 1.2, -60).stroke({ width: 2, color: s.hairShade, alpha: 0.7 });
      },
    }),
  );
  // Side locks sweeping past the jaw.
  const lockSet: [Pt, Pt, Pt, number][] =
    s.hairStyle === 'long'
      ? [
          [[-74, -130], [-50, -140], [-70, 70], 14],
          [[-62, -120], [-46, -126], [-48, 10], 6],
          [[50, -140], [74, -130], [72, 60], -14],
          [[46, -126], [62, -120], [50, 4], -6],
        ]
      : [
          [[-72, -130], [-50, -140], [-60, 24], 12],
          [[-60, -118], [-46, -124], [-46, -14], 5],
          [[50, -140], [72, -130], [62, 24], -12],
          [[46, -124], [60, -118], [48, -14], -5],
        ];
  for (const [l, r, t, cv] of lockSet) c.addChild(hairClump(s, l, r, t, cv));
  // Fringe clumps, back to front; the centre clump falls between the eyes.
  const bangs: [Pt, Pt, Pt, number][] =
    s.hairStyle === 'long'
      ? [
          // Side-swept: clumps lean toward her far side.
          [[-76, -136], [-50, -168], [-70, -60], 16],
          [[-60, -164], [-30, -182], [-50, -80], 16],
          [[46, -170], [74, -140], [66, -70], -12],
          [[24, -184], [54, -168], [44, -86], -8],
          [[-40, -180], [-8, -190], [-26, -90], 18],
          [[0, -190], [30, -184], [12, -96], 14],
          [[-20, -188], [10, -190], [-12, -74], 20],
        ]
      : [
          [[-74, -138], [-48, -168], [-66, -66], 14],
          [[48, -168], [74, -138], [66, -66], -14],
          [[-56, -168], [-26, -184], [-42, -90], 12],
          [[26, -184], [56, -168], [42, -90], -12],
          [[-30, -186], [-2, -192], [-18, -84], 12],
          [[2, -192], [30, -186], [18, -84], -12],
          [[-12, -192], [12, -192], [0, -104], 0],
        ];
  for (const [l, r, t, cv] of bangs) c.addChild(hairClump(s, l, r, t, cv));
  // Accessory.
  const orn = new Graphics();
  if (s.hairStyle === 'long') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      orn.ellipse(Math.cos(a) * 8, Math.sin(a) * 8, 8, 5).fill({ color: s.hairTip }).stroke({ width: 1.2, color: '#3b0764' });
    }
    orn.circle(0, 0, 4.5).fill({ color: '#f5c451' });
    orn.position.set(56, -160);
  } else {
    orn.roundRect(-16, -4, 32, 8, 4).fill({ color: '#f5c451' }).stroke({ width: 1.4, color: '#a4761f' });
    orn.circle(12, 0, 5).fill({ color: '#34d399' }).stroke({ width: 1.2, color: '#a4761f' });
    orn.rotation = -0.5;
    orn.position.set(-52, -150);
  }
  c.addChild(orn);
  return c;
}

// ------------------------------------------------------------------ cloth helpers

export function cloth(
  color: string,
  shadeColor: string,
  ink: string,
  shape: (g: Graphics) => void,
  details?: (g: Graphics) => void,
) {
  return celPart({
    shape,
    base: { color },
    line: ink,
    lineWidth: 2.2,
    shade: (g) => {
      // Far-side shadow band + light from the upper right.
      g.ellipse(-150, -120, 104, 420).fill({ color: shadeColor, alpha: 0.8 });
      details?.(g);
    },
  });
}

/** Volume on a fitted top: soft highlight on the upper curve and shadow beneath. */
export function bustShading(g: Graphics, shade: string, topY = -236, bottomY = -186) {
  for (const side of [1, -1]) {
    g.moveTo(side * 16, topY - 6).quadraticCurveTo(side * 48, topY - 22, side * 84, topY).stroke({ width: 6, color: WHITE, alpha: 0.22, cap: 'round' });
    g.moveTo(side * 96, bottomY - 22).quadraticCurveTo(side * 54, bottomY + 6, side * 8, bottomY - 16).stroke({ width: 9, color: shade, alpha: 0.7 });
  }
  g.moveTo(0, topY - 8).lineTo(0, bottomY - 14).stroke({ width: 3, color: shade, alpha: 0.5 });
}
