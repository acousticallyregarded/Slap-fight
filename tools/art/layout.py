"""
Rig layout for each source illustration, in source-image pixels (1024x1536).

hip:      rig origin (centre of the hips); the rig's y axis points down.
crop:     region kept from the illustration (the arena floor hides the rest).
variants: the illustrations used, in outfit-stage order. Sell's stage images
          are edits of the same picture, aligned to the first automatically.
head:     soft ellipse cut out as the head part, rotating about `pivot`.
garmentZones: optional box per Sell garment limiting where it can be.
forearm:  polygon around the slapping forearm and hand, rotating about `pivot`
          (the elbow). The body underneath is filled in by inpainting.
face:     centre, the cheek facing the opponent (impact effects), top of head,
          eyes (centre, width, tilt in radians) and mouth for the expression
          overlays, and blush spots. Colours are sampled from the illustration.
"""

LAYOUT = {
    'buy': {
        'hip': [512, 560],
        'crop': [0, 0, 1024, 1060],
        'variants': ['buy', 'buy-stage1', 'buy-stage2', 'buy-stage3', 'buy-stage4', 'buy-stage5'],
        'garmentZones': {'shorts': [330, 430, 720, 820]},
        'garmentClose': {'shorts': 45},
        # The belt's gold ring and chain read as skin tones, so they are found by what changes.
        'garmentPolyByDiff': ['sash'],
        'garmentPolys': {
            'sash': [[582, 445], [640, 445], [652, 500], [662, 600], [674, 770], [628, 778], [614, 620], [594, 500]],
            'skirt': [[422, 462], [470, 450], [560, 452], [640, 462], [700, 540], [760, 700], [820, 880], [850, 1060], [330, 1060], [372, 700], [402, 560]],
            'cropTop': [
                [455, 205], [500, 200], [520, 230], [560, 250], [600, 300], [612, 360], [600, 420], [560, 470],
                [420, 470], [395, 420], [390, 330], [410, 260], [440, 230],
            ],
        },
        'head': {'center': [505, 112], 'radii': [100, 105], 'feather': 16, 'pivot': [495, 215]},
        'forearm': {
            'pivot': [675, 455],
            'poly': [
                [556, 262], [585, 246], [612, 236], [642, 236], [662, 262], [670, 298], [686, 330], [694, 372],
                [700, 412], [704, 452], [676, 468], [648, 452], [636, 412], [622, 364], [608, 322], [588, 304], [562, 292],
            ],
        },
        'face': {
            'center': [522, 150],
            'cheekIn': [552, 168],
            'headTop': [505, 30],
            'eyes': [[497, 117, 32, 0.36], [556, 139, 28, 0.36]],
            'mouth': [516, 170, 26, 0.3],
            'cheeks': [[488, 146], [551, 161]],
        },
    },
    'sell': {
        'hip': [440, 570],
        'crop': [0, 0, 1024, 1060],
        # Optional box [x0, y0, x1, y1] limiting where each garment can be.
        'garmentZones': {'cropTop': [250, 180, 700, 470], 'shorts': [250, 430, 700, 800]},
        # Larger closing for garments whose redraw keeps similar colours (the top's cups).
        # Garments outlined by hand where the next stage keeps a similar shape.
        'garmentPolys': {
            'cropTop': [
                [345, 300], [380, 270], [430, 285], [470, 300], [510, 280], [555, 272], [578, 300], [566, 360],
                [548, 400], [542, 470], [420, 482], [395, 440], [360, 400], [340, 350],
            ],
        },
        'variants': ['sell', 'sell-stage1', 'sell-stage2', 'sell-stage3', 'sell-stage4', 'sell-stage5'],
        'head': {'center': [478, 105], 'radii': [100, 102], 'feather': 16, 'pivot': [490, 212]},
        'forearm': {
            'pivot': [300, 440],
            'poly': [
                [266, 256], [300, 238], [328, 204], [362, 190], [398, 184], [404, 200], [384, 226], [362, 252],
                [340, 272], [332, 304], [328, 344], [326, 384], [324, 424], [312, 450], [288, 452], [276, 424],
                [274, 384], [274, 340], [266, 300],
            ],
        },
        'face': {
            'center': [482, 150],
            'cheekIn': [458, 172],
            'headTop': [470, 25],
            'eyes': [[452, 142, 26, -0.5], [500, 115, 28, -0.5]],
            'mouth': [490, 172, 24, -0.4],
            'cheeks': [[462, 162], [512, 150]],
        },
    },
}
