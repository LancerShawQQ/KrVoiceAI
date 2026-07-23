"""预生成内置音色试听样本

为 MOSS-TTS-Nano 的 18 个内置音色生成试听音频，
保存到 config/voices/samples/{voice_id}.wav。

运行后，前端点击试听按钮时直接返回预生成文件（<1秒），
无需每次调用 MOSS-TTS-Nano 实时合成（30-60秒）。

用法：
  cd KrVoiceAI
  python scripts/pregenerate_voice_samples.py
  python scripts/pregenerate_voice_samples.py --force  # 强制重新生成
"""
import sys
import shutil
from pathlib import Path

# 确保项目根目录在 sys.path 中
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from krvoiceai.app import EnlyAI

# 试听文本（自然口语化，避免太短导致"着急"感）
SAMPLE_TEXT_ZH = "大家好，欢迎收听本期播客，今天我们来聊一个有趣的话题。"
SAMPLE_TEXT_EN = "Hello everyone, welcome to our podcast. Today we'll talk about an interesting topic."
SAMPLE_TEXT_JA = "皆さんこんにちは、今回のポッドキャストへようこそ。今日は面白い話題をお話ししましょう。"

# 18 个音色及其对应语言
BUILTIN_VOICES = {
    # 中文（6个）
    "Junhao":  SAMPLE_TEXT_ZH,
    "Zhiming": SAMPLE_TEXT_ZH,
    "Weiguo":  SAMPLE_TEXT_ZH,
    "Xiaoyu":  SAMPLE_TEXT_ZH,
    "Yuewen":  SAMPLE_TEXT_ZH,
    "Lingyu":  SAMPLE_TEXT_ZH,
    # 英文（5个）
    "Trump":   SAMPLE_TEXT_EN,
    "Ava":     SAMPLE_TEXT_EN,
    "Bella":   SAMPLE_TEXT_EN,
    "Adam":    SAMPLE_TEXT_EN,
    "Nathan":  SAMPLE_TEXT_EN,
    # 日文（7个）
    "Soyo":    SAMPLE_TEXT_JA,
    "Saki":    SAMPLE_TEXT_JA,
    "Mortis":  SAMPLE_TEXT_JA,
    "Umiri":   SAMPLE_TEXT_JA,
    "Mei":     SAMPLE_TEXT_JA,
    "Anon":    SAMPLE_TEXT_JA,
    "Arisa":   SAMPLE_TEXT_JA,
}
SAMPLES_DIR = project_root / "config" / "voices" / "samples"


def main():
    force = "--force" in sys.argv or "-f" in sys.argv

    print("=" * 60)
    print("预生成内置音色试听样本（18 个音色）")
    print(f"样本目录: {SAMPLES_DIR}")
    print(f"强制重新生成: {force}")
    print("=" * 60)

    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    # 检查是否所有样本已存在
    all_voices = list(BUILTIN_VOICES.keys())
    existing = [v for v in all_voices if (SAMPLES_DIR / f"{v}.wav").exists()]
    if len(existing) == len(all_voices) and not force:
        print(f"\n所有 {len(all_voices)} 个音色样本已存在，无需重新生成。")
        print("使用 --force 可强制重新生成。")
        for v in all_voices:
            size = (SAMPLES_DIR / f"{v}.wav").stat().st_size
            print(f"  {v}.wav  ({size/1024:.0f} KB)")
        return

    to_generate = all_voices if force else [v for v in all_voices if not (SAMPLES_DIR / f"{v}.wav").exists()]
    print(f"\n需生成 {len(to_generate)} 个样本...")

    # 初始化 KrVoiceAI 应用
    print("\n初始化 TTS 引擎...")
    app = EnlyAI()
    engine = app.modules.get("tts")
    if engine is None:
        print("ERROR: TTS 引擎未初始化")
        sys.exit(1)

    import time
    for voice_id in to_generate:
        sample_text = BUILTIN_VOICES[voice_id]
        sample_path = SAMPLES_DIR / f"{voice_id}.wav"
        if sample_path.exists() and not force:
            print(f"  [跳过] {voice_id} 已存在")
            continue

        print(f"  [生成] {voice_id}...", end=" ", flush=True)
        t0 = time.time()
        try:
            tmp_path = project_root / "workspace_data" / "tmp" / f"voice_sample_{voice_id}.wav"
            tmp_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path, duration, _ = engine.synthesize(
                sample_text, voice_id, tmp_path,
            )
            # 复制到样本目录
            shutil.copy2(str(audio_path), str(sample_path))
            elapsed = time.time() - t0
            size = sample_path.stat().st_size
            print(f"完成 ({elapsed:.1f}s, {size/1024:.0f} KB, {duration:.1f}s)")
        except Exception as e:
            print(f"失败: {e}")

    # 汇总
    print("\n" + "=" * 60)
    print("生成完成！")
    for v in all_voices:
        p = SAMPLES_DIR / f"{v}.wav"
        if p.exists():
            print(f"  {v}.wav  ({p.stat().st_size/1024:.0f} KB)")
        else:
            print(f"  {v}.wav  [缺失]")
    print("=" * 60)


if __name__ == "__main__":
    main()
