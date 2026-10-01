# Art and audio assets

## Where the character art comes from

Both characters are cutout puppets made from finished illustrations supplied
by the project owner (generated images, 1024×1536):

| File | Used for |
|---|---|
| `art/source/buy.png`, `art/source/sell.png` | Below $20,000: full outfits |
| `art/source/<id>-stage1.png` | $20,000: jackets off |
| `art/source/<id>-stage2.png` | $40,000: Sell's sash, Buy's belt ring and chain off |
| `art/source/<id>-stage3.png` | $60,000: skirts off, shorts showing |
| `art/source/<id>-stage4.png` | $80,000: shorts off, bikini bottoms showing |
| `art/source/<id>-stage5.png` | $100,000: tops off, full bikinis |

Each stage image is an edit of the same picture, so the pipeline aligns them
to the first one pixel for pixel. Both characters unlock the same layer at the
same milestone.

### What is drawn by code rather than taken from the images

- Expression overlays: closed eyes (blinks, winces, happy eyes, winks), the
  open mouth, and blush. They are painted at runtime in skin and line colours
  sampled from the illustration (`client/src/pixi/IllustratedRig.ts`).
- The body under the moving head and forearm is filled by inpainting
  (OpenCV Telea for the head, xphoto FSR for the forearm) so the swing never
  reveals a hole.
- Everything else (arena, podium, impact stars, sparkles) is vector art in
  `client/src/pixi/Arena.ts`.

`client/src/pixi/CharacterRig.ts` is the older fully drawn rig. It is only
used when no illustrated assets exist.

## Rebuilding the rig from new illustrations

```
python3 -m pip install pillow numpy opencv-contrib-python-headless rembg onnxruntime
python3 tools/art/prepare.py --recut     # background removal + slicing
python3 tools/art/prepare.py buy         # re-slice one character from cached cutouts
```

The script writes `client/src/assets/rig/<id>/*.webp` and
`client/src/assets/rig/<id>.json`. `tools/art/layout.py` holds everything
specific to the pictures, in source-image pixels:

- `hip`: rig origin; `crop`: the part of the image kept (the arena floor hides the rest).
- `variants`: the images in stage order.
- `head`: ellipse and neck pivot of the head part.
- `forearm`: polygon and elbow pivot of the slapping forearm and hand.
- `face`: eye, mouth, cheek and head-top points for overlays and effects.
- `garmentPolys`, `garmentZones`, `garmentClose`, `garmentPolyByDiff`: how
  each falling garment is cut out (by default, the pixels that change between
  one stage and the next).

A new illustration with a different pose only needs these coordinates
updated. Keep the slapping hand raised near the chest or face: the strike is
a swing of the forearm about the elbow.

## Part layout (rig JSON)

```json
{
  "hip": [512, 560], "stages": 6,
  "parts": [
    { "name": "body.s0", "file": "body.s0.webp", "x": 150, "y": 1, "w": 606, "h": 1059, "z": 0, "stages": [0] },
    { "name": "head.s0", "parent": "body.s0", "pivot": [495, 215], "drive": "head", "z": 40, "stages": [0], "...": "" },
    { "name": "forearm.s0", "parent": "body.s0", "pivot": [675, 455], "drive": "nearFore", "z": 50, "stages": [0], "...": "" },
    { "name": "garment.jacket", "parent": "body.s0", "garment": "jacket", "z": 45, "stages": [0], "...": "" }
  ],
  "face": { "center": [522, 150], "cheekIn": [552, 168], "eyes": [], "mouth": {}, "cheeks": [] }
}
```

`x`/`y` is the part's top-left in source pixels; `pivot` is where it rotates.
When a stage unlocks, the `garment` part cut from the previous stage falls
away while the next stage's body, head and forearm take its place in the same
frame, so coverage is intact on every frame.

## Voice clips

`client/src/assets/voice/` holds each character's hit reaction: a quick gasp
followed by a short comic "ow", played under the slap sound when she is hit.

| File | Plays |
|---|---|
| `buy-hit-1.wav` … `buy-hit-N.wav` | Buy is slapped (random variant, never the same twice in a row) |
| `buy-hit-big.wav` | Buy is slapped by an enhanced (larger-trade) slap |
| `sell-hit-1.wav` … `sell-hit-N.wav`, `sell-hit-big.wav` | The same for Sell |

The current clips are **placeholders** made with the Piper text-to-speech
engine (`tools/voice/make_voices.py`): Buy uses the `en-us-amy-low` voice
pitched up, Sell uses `en-gb-southern_english_female-low` pitched down with a
husky filter. To replace them, drop in recorded clips with the same names
(WAV, mono, 16–48 kHz, about 1–1.5 s, peak around −1 dBFS); any number of
numbered variants is picked up at build time. Keep them playful reactions to a
comedic slap. The sound toggle mutes them.

## Hand-drawn slap and chat animations (per outfit stage)

Slaps and chat reactions play as hand-drawn frames when the current outfit
stage has them. The scene cuts to a full-body wide shot: both puppets fade
out, the frames play on the floor line, and the puppets fade back in. On a
slap, the "SLAP!" star, sparks, slap sound and hit voice fire on the contact
frame at the palm. Idle, blinking and outfit unlocks stay on the puppets, and
so does anything the art pack lacks (a stage, one slap direction, a chat
pose). Reduced motion keeps the short puppet versions.

Source: the art pack unpacked to `art/sprites/` (frames only; the pack's
sheets and preview videos are not needed):

```
art/sprites/manifest.json                       sheets + animations: [frame, seconds] lists
art/sprites/<milestone>_<Char>_Slap/0..7.png    Buy faces right, Sell faces left
art/sprites/<milestone>_<Char>_Reaction/0..7.png
art/sprites/<milestone>_<Char>_Chat/0..11.png   poses shared by the chat animations
```

`<milestone>` is `0k`, `20k`, `40k`, `60k`, `80k` or `100k` (stages 0 to 5)
and `<Char>` is `Buy` or `Sell`. Chat animations are Greeting, Attention,
Compliment, Flirt, Boundary, Laugh, Cheer and GG; the game maps its chat
categories onto them (`POSE_FOR` in `client/src/game/Director.ts`). A slap
needs the attacker's Slap and the defender's Reaction; a chat reaction needs
both characters' Chat sheets (the one not reacting holds pose 0).

After the final milestone ($100,000) trades no longer slap: each one starts a
short dance party (confetti, both characters dancing), and the final unlock
itself starts a long one. The dance strings together each character's
Cheer, Greeting, GG and Laugh chat poses on a bouncing beat. Dedicated dance
frames replace that when present, played in order at 0.28 s per frame and
looped (unless the manifest lists an animation for them):

- `art/sprites/100k_Pair_Dance/0..n.png`: both characters in each tile (Buy
  left, Sell right), played centre stage. The current set was sliced from the
  supplied 4×2 sheet (`art/sprites/100k_Pair_Dance_sheet.png`, 384×512 tiles).
- or `100k_Buy_Dance/` and `100k_Sell_Dance/`: one character per tile.

Frames are full-body poses on a flat grey backdrop, boots included, drawn at
one size. Keep hands and hair inside each tile, and leave "SLAP" and other
impact text out: the game adds it at contact. Timing: contact 0.65 s into
the slap, and the reaction starts 0.2 s after the slap.

Build:

```
python3 tools/art/sprites.py        # every stage
python3 tools/art/sprites.py 3      # one stage
```

The script keys out the backdrop, removes bits of neighbouring poses that
bleed in from the sheet, stands every frame on the boots' baseline, writes
`client/src/assets/sprites/s<stage>/*.webp` plus `s<stage>.json`, and lists
frames where the figure runs into a tile edge. The slapping palm is found on
the contact frame; the slapped cheek comes from `CHEEKS` in the script
(stage 0's values serve every stage without its own entry).
