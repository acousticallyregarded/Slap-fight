"""
Generates the placeholder voice clips for both characters with the Piper
TTS engine: hit reactions (a sharp gasp, then a yelp) and flirty lines (a
soft sigh, then a giggle) for the coy chat reaction and outfit unlocks.

    python3 tools/voice/make_voices.py <piper voices dir>

The voices dir must hold en-us-amy-low/ (Buy) and
en-gb-southern_english_female-low/ (Sell) from the Piper v0.0.2 release
(github.com/rhasspy/piper/releases/tag/v0.0.2). Needs piper-tts, librosa,
soundfile and numpy.

Output: client/src/assets/voice/<id>-hit-<n>.wav, <id>-hit-big.wav and
<id>-flirt-<n>.wav (16 kHz mono WAV). Replace them with recorded clips of the
same names to change the voices; any number of numbered variants is picked up.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'client' / 'src' / 'assets' / 'voice'
SR = 16000

VOICES = {
    # Buy: brighter and higher.
    'buy': {
        'model': 'en-us-amy-low', 'pitch': 3.0, 'length': 0.8, 'breath': 0.0, 'lowpass': None,
        'lines': ['Kyaa!', 'Hyaah! Ow!', 'Ahh! Hey!'], 'big': 'Kyaaaah! Ow, ow, ow!',
        'flirt': ['Hehe. Oh my.', 'Mm, hehe!', 'Aww, hehe.'],
    },
    # Sell: lower and huskier.
    'sell': {
        'model': 'en-gb-southern_english_female-low', 'pitch': -1.0, 'length': 0.95, 'breath': 0.012, 'lowpass': 3400,
        'lines': ['Ahh!', 'Hngh! Hey!', 'Aah! Ouch!'], 'big': 'Aaaah! How dare you!',
        'flirt': ['Mm, hehe.', 'Oh? How cheeky.', 'Hmm. Hehe.'],
    },
}


def tts(model_dir: Path, text: str, length: float) -> np.ndarray:
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / 'o.wav'
        subprocess.run(
            [sys.executable, '-m', 'piper', '-m', str(model_dir / f'{model_dir.name}.onnx'), '-f', str(wav), '--length-scale', str(length)],
            input=text.encode(), check=True, capture_output=True,
        )
        y, _ = librosa.load(wav, sr=SR)
    return y


def gasp(rng: np.random.Generator, bright: float, dur: float = 0.2) -> np.ndarray:
    """A sharp inhale: filtered noise swelling in, cut off at the peak."""
    n = int(SR * dur)
    t = np.linspace(0, 1, n)
    noise = rng.standard_normal(n)
    # Crude band-pass by differencing and smoothing.
    band = np.convolve(np.diff(noise, prepend=0), np.ones(4) / 4, mode='same')
    env = t ** 2.2 * (1 - np.exp(-(1 - t) * 30))
    return band * env * 0.26 * bright


def sigh(rng: np.random.Generator) -> np.ndarray:
    """A soft, airy exhale: low-passed noise that swells and fades."""
    n = int(SR * 0.45)
    t = np.linspace(0, 1, n)
    y = lowpass(rng.standard_normal(n), 1400)
    return y * np.sin(np.pi * t) ** 1.5 * 0.08


def lowpass(y: np.ndarray, cutoff: float) -> np.ndarray:
    spec = np.fft.rfft(y)
    freqs = np.fft.rfftfreq(len(y), 1 / SR)
    spec *= 1 / (1 + (freqs / cutoff) ** 4)
    return np.fft.irfft(spec, len(y))


def render(voices_dir: Path, cid: str, v: dict, text: str, seed: int, flirt: bool = False) -> np.ndarray:
    rng = np.random.default_rng(seed)
    speech = tts(voices_dir / v['model'], text, v['length'] * (1.15 if flirt else 1))
    speech, _ = librosa.effects.trim(speech, top_db=35)
    if v['pitch']:
        # Shift by resampling (pitch and tempo together, like a tape speed-up):
        # a phase-vocoder shift leaves a smeared, echoey sound on short clips.
        ratio = 2 ** (v['pitch'] / 12)
        speech = librosa.resample(speech, orig_sr=SR * ratio, target_sr=SR)
    if v['breath']:
        speech = speech + rng.standard_normal(len(speech)) * v['breath'] * np.abs(speech).max()
    if v['lowpass']:
        speech = lowpass(speech, v['lowpass'])
    if flirt:
        # Breathier and softer: extra air on the voice, a sigh in front.
        speech = lowpass(speech + rng.standard_normal(len(speech)) * 0.015 * np.abs(speech).max(), 3000)
        lead = [sigh(rng), np.zeros(int(SR * 0.05))]
    else:
        lead = [gasp(rng, 1.3 if cid == 'buy' else 1.0), np.zeros(int(SR * 0.02))]
    y = np.concatenate([*lead, speech, np.zeros(int(SR * 0.05))])
    fade = int(SR * 0.02)
    y[-fade:] *= np.linspace(1, 0, fade)
    return (y / (np.abs(y).max() + 1e-9) * (0.7 if flirt else 0.9)).astype(np.float32)


def main():
    voices_dir = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    for cid, v in VOICES.items():
        for i, line in enumerate(v['lines'], 1):
            sf.write(OUT / f'{cid}-hit-{i}.wav', render(voices_dir, cid, v, line, i), SR, subtype='PCM_16')
        sf.write(OUT / f'{cid}-hit-big.wav', render(voices_dir, cid, v, v['big'], 99), SR, subtype='PCM_16')
        for i, line in enumerate(v['flirt'], 1):
            sf.write(OUT / f'{cid}-flirt-{i}.wav', render(voices_dir, cid, v, line, 50 + i, flirt=True), SR, subtype='PCM_16')
        print(cid, 'done')


if __name__ == '__main__':
    main()
