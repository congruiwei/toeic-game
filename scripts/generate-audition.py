#!/usr/bin/env python3
"""Generate the voice-selection samples locally; no inference service is used.

Keep the environment, downloaded weights, phoneme cache and WAVs outside the
checkout. See docs/KOKORO-AUDITION.md for installation and reproducible inputs.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re
import subprocess
import time

import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[1]
RATE = 24000
RECIPE = "audition-v1-misaki-094-trim55-pad80-120-lufs16-aac48"
ENCODING = "lufs16-tp3-aac48-decoded-4x-peak095"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_suffix(path.suffix + ".tmp")
    staging.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    staging.replace(path)


def trim_edges(audio):
    """Trim only outer silence with conservative consonant-preserving padding."""
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError("Empty or non-finite waveform")
    frame = RATE // 100
    padded = np.pad(audio, (0, (-len(audio)) % frame))
    rms = np.sqrt(np.mean(padded.reshape(-1, frame) ** 2, axis=1))
    active = np.flatnonzero(rms > 10 ** (-55 / 20))
    if not len(active):
        raise ValueError("Silent waveform")
    start = max(0, int(active[0] * frame - .08 * RATE))
    end = min(len(audio), int((active[-1] + 1) * frame + .12 * RATE))
    return audio[start:end]


def encode(audio, output, temp):
    output.parent.mkdir(parents=True, exist_ok=True)
    wav = temp / (digest(str(output).encode())[:16] + ".wav")
    # Preserve rare out-of-range model peaks until loudness processing; writing
    # them to integer PCM first would clip them before the limiter can act.
    sf.write(wav, audio, RATE, subtype="FLOAT" if np.max(np.abs(audio)) > 1 else "PCM_24")
    analysis = run("ffmpeg", "-hide_banner", "-nostats", "-i", str(wav),
                   "-af", "loudnorm=I=-16:TP=-3:LRA=11:print_format=json", "-f", "null", "-")
    match = re.search(r'\{\s*"input_i".*?\}', analysis.stderr, re.S)
    if not match:
        raise ValueError("Missing loudness analysis: " + str(output))
    measured = json.loads(match.group())
    if not all(math.isfinite(float(measured[k])) for k in ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]):
        raise ValueError("Invalid loudness measurements: " + str(output))
    filt = ("loudnorm=I=-16:TP=-3:LRA=11:linear=true:"
            f"measured_I={measured['input_i']}:measured_TP={measured['input_tp']}:"
            f"measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}:"
            f"offset={measured['target_offset']}")
    # AAC reconstruction can overshoot the pre-encoding true-peak limit. Check
    # the actual delivered file at 4x sample rate, then give only affected clips
    # additional headroom. Never clip a floating waveform to hide an overshoot.
    gain = 1.0
    for attempt in range(4):
        run("ffmpeg", "-v", "error", "-y", "-i", str(wav), "-af", filt + f",volume={gain:.8f}",
            "-ac", "1", "-ar", str(RATE), "-c:a", "aac", "-b:a", "48k",
            "-movflags", "+faststart", "-map_metadata", "-1", str(output))
        decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-ar", str(RATE * 4),
                                  "-f", "f32le", "-acodec", "pcm_f32le", "-"], check=True, capture_output=True)
        values = np.frombuffer(decoded.stdout, dtype="<f4")
        if not len(values) or not np.isfinite(values).all():
            raise ValueError("Invalid AAC reconstruction: " + str(output))
        peak = float(np.max(np.abs(values)))
        if .005 < peak <= .95:
            break
        gain *= .90 / max(peak, .005)
    else:
        raise ValueError("AAC peak verification failed: " + str(output))
    probe = json.loads(run("ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(output)).stdout)
    stream = probe["streams"][0]
    duration = float(probe["format"]["duration"])
    assert stream["codec_name"] == "aac" and stream["channels"] == 1
    assert int(stream["sample_rate"]) == RATE and .25 < duration < 180
    result = {"src": "./" + output.relative_to(ROOT).as_posix(),
              "duration": round(duration, 3), "bytes": output.stat().st_size,
              "sha256": digest(output.read_bytes()), "decodedPeak": round(peak, 6),
              "headroomDb": round(20 * math.log10(gain), 3)}
    wav.unlink()
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", type=Path, default=Path.home() / ".local/share/toeic-kokoro")
    parser.add_argument("--voices", nargs="*", help="Generate only these candidates, preserving other completed candidates")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    work = args.workdir.resolve()
    if work == ROOT or ROOT in work.parents:
        parser.error("The work directory must be outside the repository")
    temp = work / "tmp/audition"
    temp.mkdir(parents=True, exist_ok=True)
    source_bytes = (ROOT / "data/audio-audition-source.json").read_bytes()
    source = json.loads(source_bytes)
    model = work / "models/kokoro-v1.0.onnx"
    voicefile = work / "models/voices-v1.0.bin"
    identity = {"recipe": RECIPE, "modelSha256": digest(model.read_bytes()),
                "voicesSha256": digest(voicefile.read_bytes()),
                "packages": {name: importlib.metadata.version(name) for name in ["kokoro-onnx", "misaki", "onnxruntime", "soundfile", "numpy"]}}
    # A cached waveform depends on the actual phonemes, not unrelated samples.
    # The published manifest additionally binds the entire reviewed source file.
    audio_identity = dict(identity)
    identity["encoding"] = ENCODING
    identity["sourceSha256"] = digest(source_bytes)
    ort.set_seed(12345)
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    kokoro = Kokoro.from_session(session, str(voicefile))
    phonemizers = {}
    phoneme_cache = {}
    manifest_path = ROOT / "data/audio-audition-manifest.json"
    manifest = {"version": 1, "model": source["model"], "complete": False, "generation": identity, "clips": {}}
    if args.voices and manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        if previous.get("generation") == identity:
            manifest["clips"] = previous["clips"]
    all_ids = {v["id"] for v in source["voices"]}
    if args.voices and not set(args.voices) <= all_ids:
        parser.error("Unknown candidate voice")
    for voice in source["voices"]:
        vid, lang = voice["id"], voice["lang"]
        if args.voices and vid not in args.voices:
            continue
        if vid not in kokoro.voices:
            raise ValueError("Voice missing from local model pack: " + vid)
        if lang not in phonemizers:
            if lang == "ja-JP":
                from misaki import ja
                phonemizers[lang] = ja.JAG2P()
            else:
                from misaki import en, espeak
                british = lang == "en-GB"
                phonemizers[lang] = en.G2P(british=british, fallback=espeak.EspeakFallback(british=british))
        clips = manifest["clips"].setdefault(vid, {})
        for sample in source["samples"]:
            if (sample["language"] == "ja") != (lang == "ja-JP"):
                continue
            started = time.monotonic()
            records, arrays = [], []
            for i, line in enumerate(sample["segments"]):
                spoken = line.get("spoken", line["text"])
                if re.search(r'\[[1-4]\]', spoken):
                    raise ValueError("Insertion markers must not be pronounced")
                if re.search(r'\d|\$', spoken):
                    raise ValueError("Write the intended numeric pronunciation in spoken: " + line["key"])
                cache_key = (lang, spoken)
                if cache_key not in phoneme_cache:
                    phonemes, _ = phonemizers[lang](spoken)
                    if not phonemes.strip() or "❓" in phonemes:
                        raise ValueError("Unknown pronunciation: " + line["key"])
                    missing = set(phonemes) - set(kokoro.tokenizer.vocab)
                    if missing:
                        raise ValueError(f"Unsupported phonemes {missing!r}: {line['key']}")
                    phoneme_cache[cache_key] = phonemes
                phonemes = phoneme_cache[cache_key]
                fingerprint = digest(json.dumps([audio_identity, vid, phonemes], sort_keys=True).encode())
                raw = temp / (fingerprint + ".wav")
                if raw.exists():
                    audio, sample_rate = sf.read(raw, dtype="float32")
                    assert sample_rate == RATE
                else:
                    audio, sample_rate = kokoro.create(phonemes, voice=vid, speed=1.0, is_phonemes=True, trim=False)
                    assert sample_rate == RATE
                    audio = trim_edges(audio)
                    sf.write(raw, audio, RATE, subtype="FLOAT")
                path = ROOT / "audio/audition" / vid / (sample["id"] + f"-{i + 1:02d}.m4a")
                record = encode(audio, path, temp)
                record["key"] = line["key"]
                records.append(record)
                if arrays:
                    # A dialogue turn/answer gets more space than a sentence in a monologue.
                    pause = .40 if sample["kind"] in ("part2", "part3") else .24
                    arrays.append(np.zeros(round(RATE * pause), dtype=np.float32))
                arrays.append(audio)
                write_json(temp / (fingerprint + ".json"), {"key": line["key"], "voice": vid, "text": line["text"], "spoken": spoken, "phonemes": phonemes, "generation": identity})
            if len(records) == 1:
                full = {k: v for k, v in records[0].items() if k != "key"}
            else:
                full = encode(np.concatenate(arrays), ROOT / "audio/audition" / vid / (sample["id"] + ".m4a"), temp)
            clips[sample["id"]] = {**full, "segments": records}
            write_json(manifest_path, manifest)
            print(f"{vid} / {sample['id']}: {len(records)} lines, {full['duration']:.1f}s audio, {time.monotonic() - started:.1f}s elapsed", flush=True)
    unique = {entry["src"]: entry for voice in manifest["clips"].values() for clip in voice.values() for entry in [clip, *clip["segments"]]}
    manifest["totals"] = {"voices": len(manifest["clips"]), "samples": sum(len(v) for v in manifest["clips"].values()),
                          "files": len(unique), "bytes": sum(e["bytes"] for e in unique.values()),
                          "duration": round(sum(e["duration"] for e in unique.values()), 3)}
    manifest["complete"] = len(manifest["clips"]) == len(source["voices"]) and all(
        len(manifest["clips"].get(v["id"], {})) == sum(
            (s["language"] == "ja") == (v["lang"] == "ja-JP") for s in source["samples"])
        for v in source["voices"])
    write_json(manifest_path, manifest)
    print(json.dumps(manifest["totals"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
