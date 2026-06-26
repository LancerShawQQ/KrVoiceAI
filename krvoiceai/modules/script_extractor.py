"""对标文案提取模块

从参考视频 URL 提取口播文案。

流程：
1. yt-dlp 下载视频（仅音频流，节省带宽）
2. ASR 转写为带标点文本（支持 MiMo ASR / FunASR）
3. 文本清洗（去语气词、合并断句）

合规说明：仅支持用户手动提供链接，不做批量爬取；
仅提取文案用于参考改写，不直接复用原文。

mock 模式：不下载，返回模拟的口播文案。
"""
from __future__ import annotations

import base64
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Optional

import httpx

from ..core.base_module import BaseModule, JobContext, ModuleResult
from ..core.ffmpeg_utils import FFmpegRunner


# 语气词与无意义填充词（用于清洗）
FILLER_WORDS = [
    "嗯", "啊", "呃", "那个", "这个", "就是", "然后", "对吧",
    "你知道吗", "怎么说呢", "反正", "其实吧",
]

# URL 边界排除字符集：URL 中不应出现的字符（空格、<>、中文、各类引号/包裹符）
# 关键：含反引号 `、单双引号、中文引号「」『』、方括号【】[]、括号（）()
# 修复历史 Bug：抖音分享文本常以反引号包围 URL，旧正则未排除反引号导致 URL 末尾带 `
_URL_BOUNDARY_CHARS = r"`'\"\u300c\u300d\u300e\u300f\u3010\u3011\[\]\uff08\uff09\(\)"

# URL 末尾清理字符集：strip 这些可能粘在 URL 末尾的标点
_URL_TRAILING_CHARS = ",.;!?，。；！？、）)】」』`'\""

# 描述末尾清理字符集：含省略号、反引号、引号等包裹符（修复反引号边界 Bug）
_DESC_TRAILING_CHARS = "….;；，,。 \n`'\"」』"


def _build_url_pattern(prefix: str = r"https?://") -> str:
    """构建 URL 匹配正则：prefix + 非边界字符序列"""
    return prefix + r"[^\s<>\u4e00-\u9fa5" + _URL_BOUNDARY_CHARS + r"]+"


class ScriptExtractor(BaseModule):
    """对标文案提取模块"""

    name = "script_extract"
    requires_gpu = False

    def __init__(self, config=None, ffmpeg: FFmpegRunner | None = None):
        super().__init__(config)
        self.asr_provider = self.config.get("asr.provider", "mock")
        self.ffmpeg = ffmpeg or FFmpegRunner()
        self._ytdlp_available: Optional[bool] = None
        # MiMo ASR 配置
        self.mimo_api_base = self.config.get("asr.api_base", "")
        self.mimo_api_key = self.config.get("asr.api_key", "")
        self.mimo_model = self.config.get("asr.mimo_model", "mimo-v2.5-asr")
        self.timeout = self.config.get("asr.timeout", 120)

    def setup(self) -> None:
        # yt-dlp 检测：优先命令行，其次 Python 模块
        self._ytdlp_available = shutil.which("yt-dlp") is not None
        if not self._ytdlp_available:
            try:
                import yt_dlp  # noqa: F401
                self._ytdlp_available = True
                self._ytdlp_as_module = True
            except ImportError:
                self._ytdlp_as_module = False
        else:
            self._ytdlp_as_module = False
        if not self._ytdlp_available:
            self.logger.warning("yt-dlp 未安装，视频链接提取将不可用（本地文件提取仍可用）")
        # 检查 ASR provider 是否可用
        if self.asr_provider == "mimo":
            if not self.mimo_api_key or not self.mimo_api_base:
                self.logger.warning("MiMo ASR 未配置 api_key/api_base，降级到 mock 模式")
                self.asr_provider = "mock"
            else:
                self.logger.info(f"文案提取模块初始化 yt-dlp={'可用' if self._ytdlp_available else '不可用'}, ASR=mimo/{self.mimo_model}")
        elif self.asr_provider == "funasr":
            self.logger.info(f"文案提取模块初始化 yt-dlp={'可用' if self._ytdlp_available else '不可用'}, ASR=funasr")
        elif self.asr_provider == "whisper_local":
            # whisper_local 用于本地文件转写（不依赖 yt-dlp）
            try:
                import faster_whisper  # noqa: F401
                self.logger.info(f"文案提取模块初始化 yt-dlp={'可用' if self._ytdlp_available else '不可用'}, ASR=whisper_local")
            except ImportError:
                self.logger.warning("faster-whisper 未安装，本地文件转写将降级 mock。安装：pip install -e \".[local]\"")
        else:
            self.logger.info(f"文案提取模块初始化 yt-dlp={'可用' if self._ytdlp_available else '不可用'}, ASR=mock")
        super().setup()

    def run(self, ctx: JobContext) -> ModuleResult:
        """从 ctx.reference_video_url 提取文案"""
        url = ctx.reference_video_url
        if not url:
            # 无参考视频 URL，跳过此步骤
            return ModuleResult(
                success=True,
                data={"skipped": True, "reason": "无参考视频 URL"},
            )

        try:
            # yt-dlp 可用且 ASR provider 支持（mimo/funasr）时走真实提取
            use_real = self._ytdlp_available and self.asr_provider in ("funasr", "mimo")
            if use_real:
                text = self._extract_real(url, ctx.work_dir)
            else:
                text = self._extract_mock(url)

            text = self._clean_text(text)
            ctx.metadata["extracted_script"] = text
            # 提取的文案作为 input_script，供后续 script_write 仿写
            if not ctx.input_script:
                ctx.input_script = text

            return ModuleResult(
                success=True,
                data={
                    "script_text": text,
                    "source_url": url,
                    "char_count": len(text),
                    "mock": not use_real,
                },
            )
        except Exception as e:
            return ModuleResult(success=False, error=str(e))

    def extract(self, video_url: str, lang: str = "zh") -> str:
        """直接调用接口：从视频/文章 URL 或本地文件提取文案

        支持三类输入：
        1. 本地视频/音频文件（路径存在）：FFmpeg 提取音频 + ASR 转写
        2. 视频链接（抖音/快手/B站/YouTube）：yt-dlp 下载音频 + ASR 转写
        3. 文章链接（腾讯新闻/微信公众号/新浪新闻等）：requests 抓取网页正文
        """
        # === 优先检测本地文件 ===
        cleaned_input = video_url.strip().strip('"').strip("'")
        local_path = Path(cleaned_input)
        if local_path.exists() and local_path.is_file():
            return self._extract_from_local_file(local_path)

        # 从分享文本中提取真实 URL（用户可能粘贴整段抖音分享文案）
        video_url = self._extract_url_from_text(video_url)
        if not video_url:
            raise ValueError("无法从输入中识别有效的视频链接或本地文件，请粘贴包含抖音/快手/B站/YouTube 链接的内容，或提供本地视频文件路径")

        # 判断是视频链接还是文章链接
        is_video = self._is_video_url(video_url)

        if is_video:
            # 视频链接：yt-dlp + ASR
            use_real = self._ytdlp_available and self.asr_provider in ("funasr", "mimo", "whisper_local")
            if use_real:
                import tempfile
                with tempfile.TemporaryDirectory() as tmp:
                    try:
                        text = self._extract_real(video_url, Path(tmp))
                    except Exception as e:
                        self.logger.warning(f"视频音频下载/转写失败: {e}")
                        # 抖音/快手强力反爬常导致下载失败，优先用分享文本里的文案描述
                        desc = self._extract_desc_from_share_text(video_url if False else cleaned_input)
                        if desc:
                            self.logger.info(f"已从分享文本提取文案描述: {len(desc)} 字")
                            text = desc
                        else:
                            # 没有分享文案，尝试文章提取
                            try:
                                text = self._extract_article(video_url)
                            except Exception as e2:
                                self.logger.warning(f"文章提取也失败: {e2}")
                                raise RuntimeError(
                                    f"无法下载视频音频（{str(e)[:80]}），"
                                    f"且分享文本中无文案描述。请直接在第①步手动输入文案，"
                                    f"或粘贴抖音分享文本（含文案描述）。"
                                )
            else:
                # yt-dlp 或 ASR 不可用：优先用分享文案描述，再降级 mock
                desc = self._extract_desc_from_share_text(cleaned_input)
                if desc:
                    self.logger.info(f"yt-dlp/ASR 不可用，使用分享文本文案描述: {len(desc)} 字")
                    text = desc
                else:
                    text = self._extract_mock(video_url)
        else:
            # 文章链接：直接抓取网页正文
            try:
                text = self._extract_article(video_url)
            except Exception as e:
                self.logger.warning(f"文章提取失败，降级到 mock: {e}")
                text = self._extract_mock(video_url)
        return self._clean_text(text)

    def _extract_from_local_file(self, path: Path) -> str:
        """从本地视频/音频文件提取文案：FFmpeg 提取音频 + ASR 转写"""
        self.logger.info(f"从本地文件提取文案: {path.name}")

        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # 提取音频为 wav，并做音量归一化（loudnorm）+ 提升低音量
            # 原因：手机录制视频常出现 mean_volume < -40dB 的极低音量，
            # whisper 在此条件下无法识别语音。loudnorm 标准化到 -16dB 响度。
            audio_path = tmp_path / "audio.wav"
            try:
                # 先提取原始音频
                raw_audio = tmp_path / "raw.wav"
                self.ffmpeg.convert_audio(path, raw_audio, sample_rate=16000, channels=1)
                # 再做音量归一化（dynaudnorm 自适应增益 + 提升整体音量）
                import subprocess
                norm_cmd = [
                    self.ffmpeg.ffmpeg, "-y", "-i", str(raw_audio),
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=16000",
                    "-ac", "1",
                    str(audio_path),
                ]
                r = subprocess.run(norm_cmd, capture_output=True, text=True)
                if r.returncode != 0 or not audio_path.exists():
                    # loudnorm 失败则用原始音频
                    self.logger.warning(f"loudnorm 失败，用原始音频: {r.stderr[-200:]}")
                    audio_path = raw_audio
                else:
                    self.logger.info("音频已归一化（loudnorm -16dB）")
            except Exception as e:
                raise RuntimeError(f"音频提取失败（{path.name}）: {e}")

            # 根据 provider 转写
            if self.asr_provider == "mimo":
                return self._clean_text(self._transcribe_mimo(audio_path))
            elif self.asr_provider == "funasr":
                try:
                    return self._clean_text(self._transcribe_funasr(audio_path))
                except ImportError:
                    self.logger.warning("FunASR 未安装，降级到 whisper/mock")
                    return self._clean_text(self._transcribe_local(audio_path))
            elif self.asr_provider == "whisper_local":
                return self._clean_text(self._transcribe_local(audio_path))
            else:
                self.logger.warning(f"ASR provider={self.asr_provider} 不支持转写，降级 mock")
                return self._clean_text(self._extract_mock(str(path)))

    def _transcribe_local(self, audio_path: Path) -> str:
        """使用 faster-whisper 本地转写（CPU int8）

        用于本地文件文案提取；whisper_local provider 不可用时降级 mock。
        """
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            self.logger.warning("faster-whisper 未安装，文案提取降级 mock")
            return self._extract_mock(str(audio_path))

        whisper_cfg = self.config.get("asr.whisper", {}) or {}
        model_size = whisper_cfg.get("model_size", "small")
        device = whisper_cfg.get("device", "cpu")
        compute_type = whisper_cfg.get("compute_type", "int8")

        self.logger.info(
            f"faster-whisper 本地转写: {audio_path.name} model={model_size}"
        )
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, _ = model.transcribe(
            str(audio_path), language="zh", vad_filter=True,
        )
        text = "".join(seg.text for seg in segments).strip()
        self.logger.info(f"转写完成: {len(text)} 字, 预览: {text[:80]}")
        return text

    @staticmethod
    def _is_video_url(url: str) -> bool:
        """判断 URL 是否为视频链接"""
        video_domains = (
            "douyin.com", "iesdouyin.com", "kuaishou.com",
            "bilibili.com", "b23.tv", "youtube.com", "youtu.be",
            "weibo.com", "xiaohongshu.com",
        )
        return any(d in url for d in video_domains)

    def _extract_article(self, url: str) -> str:
        """从新闻/文章页面提取正文文本

        支持：腾讯新闻、微信公众号、新浪新闻、网易新闻、知乎专栏等
        """
        self.logger.info(f"提取文章正文: {url}")
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        r = httpx.get(url, headers=headers, timeout=30, follow_redirects=True)
        r.raise_for_status()
        html = r.text

        # 提取标题
        title = ""
        title_match = re.search(r"<title[^>]*>([^<]+)</title>", html)
        if title_match:
            title = title_match.group(1).strip()
            # 清理常见后缀
            title = re.sub(r"\s*[-_|]\s*腾讯新闻.*$", "", title)
            title = re.sub(r"\s*[-_|]\s*新浪.*$", "", title)
            title = re.sub(r"\s*[-_|]\s*网易.*$", "", title)

        # 提取正文段落：<p> 标签中长度 > 30 的文本
        # 先移除 script/style 标签内容
        clean_html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        clean_html = re.sub(r"<style[^>]*>.*?</style>", "", clean_html, flags=re.DOTALL | re.IGNORECASE)
        # 提取所有 <p> 标签内容
        paragraphs = re.findall(r"<p[^>]*>(.*?)</p>", clean_html, flags=re.DOTALL | re.IGNORECASE)
        # 清理 HTML 标签，保留纯文本
        body_parts = []
        for p in paragraphs:
            # 移除内部 HTML 标签
            text = re.sub(r"<[^>]+>", "", p).strip()
            # 过滤短文本（导航、广告等）
            if len(text) >= 30:
                body_parts.append(text)

        # 如果 <p> 标签提取失败，尝试 meta description
        if not body_parts:
            desc_match = re.search(r'<meta\s+name="description"\s+content="([^"]+)"', html, re.IGNORECASE)
            if desc_match:
                body_parts.append(desc_match.group(1).strip())

        if not body_parts:
            raise RuntimeError("无法从页面提取正文内容")

        # 组合标题 + 正文
        result = title + "\n" + "\n".join(body_parts) if title else "\n".join(body_parts)
        self.logger.info(f"文章提取完成: {len(result)} 字, {len(body_parts)} 段")
        return result

    @staticmethod
    def _extract_url_from_text(text: str) -> str:
        """从用户输入的文本中提取视频 URL

        用户可能粘贴整段抖音分享文案，如：
        "2.87 复制打开抖音，看看【侃侃体育的作品】... https://v.douyin.com/5lPIfwzFtH0/ 03/29 ULw:/"
        需要从中提取出 https://v.douyin.com/5lPIfwzFtH0/

        支持 URL 被反引号/引号/括号包围的场景：
        "看看【xx的作品】文案... `https://v.douyin.com/xxx/` anq:/ :1pm"
        """
        if not text:
            return ""
        text = text.strip()
        # 从文本中匹配 URL（支持抖音/快手/B站/YouTube短链）
        # 边界排除反引号/引号/括号等包裹符，避免 URL 末尾带包裹符
        # 统一走 findall：能正确处理纯 URL、URL+口令后缀、被包裹符包围的 URL
        url_pattern = _build_url_pattern(r"https?://")
        matches = re.findall(url_pattern, text)
        if matches:
            return matches[0].rstrip(_URL_TRAILING_CHARS)
        # 尝试匹配不带 https 的短链（如 v.douyin.com/xxx）
        short_pattern = _build_url_pattern(r"(?:v\.douyin\.com|v\.kuaishou\.com|b23\.tv|youtu\.be)/")
        matches = re.findall(short_pattern, text)
        if matches:
            return "https://" + matches[0].rstrip(_URL_TRAILING_CHARS)
        return ""

    @staticmethod
    def _extract_desc_from_share_text(text: str) -> str:
        """从抖音/快手分享文本中提取视频文案描述（最可靠，无需下载）

        抖音分享格式：
        "1.25 复制打开抖音，看看【风芒新闻的作品】深圳一三甲医院涉嫌伪造病历... https://v.douyin.com/xxx/"

        快手/B站分享也含描述。这是最可靠的方式，因为抖音/快手有强力反爬，
        yt-dlp 经常因 cookie 问题无法下载。返回空串表示未提取到。
        """
        if not text:
            return ""
        text = text.strip()
        # URL 前置边界：允许空格/反引号/引号等包裹符出现在 URL 前
        # 修复历史 Bug：抖音分享文本常以反引号包围 URL，旧正则只允许 \s+ 导致描述吞掉整个 URL
        _url_prefix_boundary = r"(?:[\s`'\"\u300c\u300d\u300e\u300f]*https?://|$)"
        # 抖音：【作者的作品】文案内容 https://...
        m = re.search(r"看看【(.+?)】(.+?)" + _url_prefix_boundary, text)
        if m:
            desc = m.group(2).strip()
            # 去掉末尾省略号或标点（含反引号等包裹符）
            desc = desc.rstrip(_DESC_TRAILING_CHARS)
            if len(desc) >= 4:
                return desc
        # 快手：复制打开快手...文案 https://...
        m = re.search(r"复制打开快[手眼][，,]?\s*(.+?)" + _url_prefix_boundary, text)
        if m:
            desc = m.group(1).strip().rstrip(_DESC_TRAILING_CHARS)
            if len(desc) >= 4:
                return desc
        # 通用：URL 之前的中文描述（去掉前缀"复制打开xxx"）
        url_pos = text.find("http")
        if url_pos > 10:
            prefix = text[:url_pos].strip()
            # 去掉常见的分享前缀
            prefix = re.sub(r"^[\d.]+\s*复制打开[^，,]*[，,]?\s*", "", prefix)
            prefix = re.sub(r"^看看【[^】]*】\s*", "", prefix)
            prefix = prefix.strip().rstrip(_DESC_TRAILING_CHARS)
            if len(prefix) >= 4:
                return prefix
        return ""

    def _extract_real(self, url: str, work_dir: Path) -> str:
        """真实提取：yt-dlp 下载 + ASR 转写（支持 MiMo / FunASR / whisper_local）"""
        self.logger.info(f"下载视频音频: {url}")

        # yt-dlp 下载音频（优先 Python API，其次命令行）
        output_template = str(work_dir / "ref.%(ext)s")
        downloaded = self._ytdlp_download_audio(url, output_template)
        if not downloaded:
            raise RuntimeError("yt-dlp 下载失败或未找到音频文件")

        audio_path = downloaded
        self.logger.info(f"下载完成: {audio_path.name} ({audio_path.stat().st_size // 1024}KB)")

        # 音量归一化（部分平台下载的音频音量偏低）
        norm_audio = work_dir / "ref_norm.wav"
        try:
            import subprocess
            r = subprocess.run(
                [self.ffmpeg.ffmpeg, "-y", "-i", str(audio_path),
                 "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                 "-ar", "16000", "-ac", "1", str(norm_audio)],
                capture_output=True, text=True,
            )
            if r.returncode == 0 and norm_audio.exists():
                audio_path = norm_audio
        except Exception:
            pass

        # 根据 provider 选择 ASR
        if self.asr_provider == "mimo":
            return self._transcribe_mimo(audio_path)
        elif self.asr_provider == "whisper_local":
            return self._transcribe_local(audio_path)
        else:
            return self._transcribe_funasr(audio_path)

    def _ytdlp_download_audio(self, url: str, output_template: str) -> Optional[Path]:
        """用 yt-dlp 下载音频，返回下载的文件路径

        优先使用 Python API（yt_dlp.YoutubeDL），失败则回退命令行。
        """
        # 方式 1：Python API
        try:
            import yt_dlp
            opts = {
                "format": "bestaudio/best",
                "outtmpl": output_template,
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
                "http_headers": {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Referer": "https://www.douyin.com/",
                },
                "postprocessors": [{
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                }],
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            # 查找下载结果
            work_dir = Path(output_template).parent
            for ext in ("mp3", "m4a", "webm", "opus", "wav"):
                files = list(work_dir.glob(f"ref.*{ext}"))
                if files:
                    return files[0]
        except Exception as e:
            self.logger.warning(f"yt-dlp Python API 下载失败: {e}")

        # 方式 2：命令行
        if shutil.which("yt-dlp"):
            import subprocess
            cmd = [
                "yt-dlp", "-x", "--audio-format", "mp3",
                "-o", output_template,
                "--no-playlist", "--no-warnings", url,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode == 0:
                work_dir = Path(output_template).parent
                files = list(work_dir.glob("ref.*"))
                if files:
                    return files[0]
            self.logger.warning(f"yt-dlp 命令行失败: {result.stderr[-200:]}")
        return None

    def _transcribe_mimo(self, audio_path: Path) -> str:
        """使用 MiMo ASR 转写音频为文本

        MiMo ASR 端点：{api_base}/chat/completions
        - 音频以 data URL 格式传入（data:audio/mp3;base64,...）
        - 不接受 text 部分（网关注入）
        - 返回识别文本在 choices[0].message.content
        """
        self.logger.info(f"MiMo ASR 转写: {audio_path.name}")

        audio_bytes = audio_path.read_bytes()
        ext = audio_path.suffix.lower().lstrip(".")
        mime = "audio/wav" if ext == "wav" else "audio/mp3"
        audio_b64 = base64.b64encode(audio_bytes).decode()
        data_url = f"data:{mime};base64,{audio_b64}"

        payload = {
            "model": self.mimo_model,
            "messages": [
                {"role": "user", "content": [
                    {"type": "input_audio", "input_audio": {"data": data_url, "format": ext or "mp3"}}
                ]}
            ],
            "stream": False,
        }
        headers = {
            "Authorization": f"Bearer {self.mimo_api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.mimo_api_base.rstrip('/')}/chat/completions"

        r = httpx.post(url, json=payload, headers=headers, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()

        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not content:
            self.logger.warning("MiMo ASR 返回空内容，降级到 mock")
            return self._extract_mock(str(audio_path))

        self.logger.info(f"MiMo ASR 转写结果: {content[:100]}...")
        return content

    def _transcribe_funasr(self, audio_path: Path) -> str:
        """使用 FunASR 转写音频为文本"""
        self.logger.info(f"FunASR 转写: {audio_path}")
        from funasr import AutoModel
        model = AutoModel(
            model=self.config.get("asr.model", "paraformer-zh"),
            vad_model="fsmn-vad",
            punc_model="ct-punc",
            disable_update=True,
        )
        result = model.generate(input=str(audio_path), batch_size_s=300)
        text = ""
        for res in result:
            text += res.get("text", "")
        return text

    def _extract_mock(self, url: str) -> str:
        """Mock 模式：返回模拟的口播文案

        根据平台特征生成不同主题的模拟文案。
        """
        self.logger.info(f"Mock 文案提取: {url}")
        # 根据域名推断平台
        if "douyin" in url or "iesdouyin" in url:
            topic = "抖音热门话题"
        elif "kuaishou" in url:
            topic = "快手热门内容"
        elif "bilibili" in url or "b23.tv" in url:
            topic = "B站知识分享"
        elif "youtube" in url or "youtu.be" in url:
            topic = "YouTube 教程"
        else:
            topic = "热门口播话题"

        return (
            f"今天和大家聊聊{topic}。"
            f"很多人对这个话题感兴趣，但真正搞明白的人不多。"
            f"我先讲一个核心观点，然后再展开说三个要点。"
            f"第一，要抓住本质，不要被表象迷惑。"
            f"第二，方法论很重要，照着做就能少走弯路。"
            f"第三，执行力是关键，光想不做等于零。"
            f"最后给大家一个建议，从今天开始行动起来。"
            f"觉得有用的话，点赞关注收藏三连，我们下期再见。"
        )

    def _clean_text(self, text: str) -> str:
        """清洗提取的文案"""
        if not text:
            return ""
        # 去除语气词
        for word in FILLER_WORDS:
            text = text.replace(word, "")
        # 合并多余空格
        text = re.sub(r"\s+", " ", text)
        # 合并连续标点
        text = re.sub(r"[，。！？]{2,}", lambda m: m.group(0)[0], text)
        # 去除首尾空白
        return text.strip()
