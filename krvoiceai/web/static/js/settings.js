/**
 * KrVoiceAI Settings Center
 * 设置中心：模型配置 / 视频设置 / 发布设置
 */

// ========== 全局状态 ==========
let _presets = null;  // provider 预设缓存
let _currentSettings = null;  // 当前完整配置（掩码后）

// ========== 工具函数 ==========

async function ensurePresets() {
  if (!_presets) {
    _presets = await api('/api/settings/presets/all');
  }
  return _presets;
}

function showTestResult(elId, result) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cls = result.success ? 'success' : 'error';
  const icon = result.success ? '✓' : '✕';
  el.innerHTML = `<div class="test-result ${cls}">${icon} ${result.message}${result.elapsed_ms ? ` · ${result.elapsed_ms}ms` : ''}</div>`;
}

// ========== 子标签切换 ==========

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.subtab;
      document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sub-page').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`subpage-${target}`).classList.add('active');
    });
  });
});

// ========== 加载所有设置 ==========

async function loadAllSettings() {
  try {
    await ensurePresets();
    _currentSettings = await api('/api/settings');
    loadLLMSettings();
    loadTTSSettings();
    loadASRSettings();
    loadAvatarSettings();
    updateModelStatusBadges();
  } catch (e) {
    toast(`加载设置失败: ${e.message}`, 'error');
  }
}

function updateModelStatusBadges() {
  // LLM 状态
  const llmBadge = document.getElementById('llm-status-badge');
  if (llmBadge && _currentSettings) {
    const llm = _currentSettings.llm || {};
    if (llm.provider === 'mock' || !llm.api_key_configured) {
      llmBadge.className = 'badge badge-warning';
      llmBadge.textContent = 'Mock 模式';
    } else {
      llmBadge.className = 'badge badge-success';
      llmBadge.textContent = `${llm.provider} · ${llm.model || ''}`;
    }
  }
  // TTS 状态
  const ttsBadge = document.getElementById('tts-status-badge');
  if (ttsBadge && _currentSettings) {
    const tts = _currentSettings.tts || {};
    if (tts.provider === 'mock') {
      ttsBadge.className = 'badge badge-warning';
      ttsBadge.textContent = 'Mock 模式';
    } else {
      ttsBadge.className = 'badge badge-info';
      ttsBadge.textContent = tts.provider;
    }
  }
  // Avatar 状态
  const avatarBadge = document.getElementById('avatar-status-badge');
  if (avatarBadge && _currentSettings) {
    const avatar = _currentSettings.avatar || {};
    if (avatar.provider === 'mock') {
      avatarBadge.className = 'badge badge-warning';
      avatarBadge.textContent = 'Mock 模式';
    } else {
      avatarBadge.className = 'badge badge-info';
      avatarBadge.textContent = avatar.provider;
    }
  }
}

// ========== LLM 配置 ==========

function loadLLMSettings() {
  if (!_currentSettings) return;
  const llm = _currentSettings.llm || {};
  document.getElementById('llm-provider').value = llm.provider || 'mock';
  onLLMProviderChange();
  // 模型
  const modelSelect = document.getElementById('llm-model');
  const preset = _presets.llm[llm.provider];
  if (preset && preset.models) {
    modelSelect.innerHTML = preset.models.map(m =>
      `<option value="${m}" ${m === llm.model ? 'selected' : ''}>${m}</option>`
    ).join('') + '<option value="__custom__">自定义...</option>';
    if (llm.model && !preset.models.includes(llm.model)) {
      modelSelect.value = '__custom__';
      const customInput = document.getElementById('llm-model-custom');
      customInput.style.display = 'block';
      customInput.value = llm.model;
    }
  }
  // API Key
  document.getElementById('llm-api-key').value = llm.api_key || '';
  document.getElementById('llm-key-hint').textContent = llm.api_key_configured ? '已配置' : '未配置';
  // Base URL
  document.getElementById('llm-base-url').value = llm.base_url || '';
  // 高级参数
  document.getElementById('llm-temperature').value = llm.temperature ?? 0.7;
  document.getElementById('llm-temp-val').textContent = llm.temperature ?? 0.7;
  document.getElementById('llm-max-tokens').value = llm.max_tokens || 2000;
  document.getElementById('llm-timeout').value = llm.timeout || 60;
}

function onLLMProviderChange() {
  const provider = document.getElementById('llm-provider').value;
  const preset = _presets?.llm?.[provider];
  const modelSelect = document.getElementById('llm-model');
  const customInput = document.getElementById('llm-model-custom');
  customInput.style.display = 'none';

  if (preset) {
    if (preset.models && preset.models.length) {
      modelSelect.innerHTML = preset.models.map(m => `<option value="${m}">${m}</option>`).join('') + '<option value="__custom__">自定义...</option>';
    } else {
      modelSelect.innerHTML = '<option value="">无需选择模型</option>';
    }
    // 自动填充 base_url
    if (preset.base_url) {
      document.getElementById('llm-base-url').value = preset.base_url;
    }
    // API Key 获取链接
    const urlEl = document.getElementById('llm-key-url');
    if (preset.api_key_url) {
      urlEl.innerHTML = `🔗 <a href="${preset.api_key_url}" target="_blank" style="color:var(--accent-primary)">点击获取 API Key</a>`;
    } else {
      urlEl.innerHTML = '';
    }
  }
  // model select change 处理
  modelSelect.onchange = () => {
    if (modelSelect.value === '__custom__') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
    }
  };
}

async function saveLLMSettings() {
  const provider = document.getElementById('llm-provider').value;
  const modelSelect = document.getElementById('llm-model');
  let model = modelSelect.value;
  if (model === '__custom__') {
    model = document.getElementById('llm-model-custom').value;
  }
  const data = {
    provider,
    model,
    api_key: document.getElementById('llm-api-key').value,
    base_url: document.getElementById('llm-base-url').value,
    temperature: parseFloat(document.getElementById('llm-temperature').value),
    max_tokens: parseInt(document.getElementById('llm-max-tokens').value),
    timeout: parseInt(document.getElementById('llm-timeout').value),
  };
  try {
    const result = await api('/api/settings/llm', {
      method: 'PUT',
      body: { section: 'llm', data },
    });
    if (result.success) {
      toast('LLM 配置已保存', 'success');
      _currentSettings = await api('/api/settings');
      updateModelStatusBadges();
    } else {
      toast(`保存失败: ${result.message}`, 'error');
    }
  } catch (e) {
    toast(`保存失败: ${e.message}`, 'error');
  }
}

async function resetLLMSettings() {
  if (!confirm('确定重置 LLM 配置为默认？')) return;
  try {
    await api('/api/settings/llm', { method: 'DELETE' });
    toast('已重置', 'success');
    await loadAllSettings();
  } catch (e) {
    toast(`重置失败: ${e.message}`, 'error');
  }
}

async function testLLMConnection() {
  const provider = document.getElementById('llm-provider').value;
  const modelSelect = document.getElementById('llm-model');
  let model = modelSelect.value;
  if (model === '__custom__') {
    model = document.getElementById('llm-model-custom').value;
  }
  const payload = {
    provider,
    api_key: document.getElementById('llm-api-key').value,
    base_url: document.getElementById('llm-base-url').value,
    model,
  };
  const btn = document.getElementById('llm-test-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 测试中...';
  try {
    const result = await api('/api/settings/test/llm', { method: 'POST', body: payload });
    showTestResult('llm-test-result', result);
    toast(result.success ? '连接成功' : '连接失败', result.success ? 'success' : 'error');
  } catch (e) {
    showTestResult('llm-test-result', { success: false, message: e.message });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔌 测试连接';
  }
}

// ========== TTS 配置 ==========

function loadTTSSettings() {
  if (!_currentSettings) return;
  const tts = _currentSettings.tts || {};
  document.getElementById('tts-provider').value = tts.provider || 'mock';
  onTTSProviderChange();
  document.getElementById('tts-api-base').value = tts.api_base || '';
  document.getElementById('tts-api-key').value = tts.api_key || '';
  document.getElementById('tts-edge-voice').value = tts.edge_voice || 'zh-CN-XiaoxiaoNeural';
  document.getElementById('tts-default-voice').value = tts.default_voice || 'default';
  document.getElementById('tts-timeout').value = tts.timeout || 120;
}

function onTTSProviderChange() {
  const provider = document.getElementById('tts-provider').value;
  const edgeGroup = document.getElementById('tts-edge-voice-group');
  const apiBaseGroup = document.getElementById('tts-api-base-group');
  const apiKeyGroup = document.getElementById('tts-api-key-group');

  edgeGroup.style.display = provider === 'edge_tts' ? 'block' : 'none';
  apiBaseGroup.style.display = provider === 'gpt_sovits' ? 'block' : 'none';
  apiKeyGroup.style.display = provider === 'gpt_sovits' ? 'block' : 'none';

  // 自动填充默认地址
  if (_presets && _presets.tts[provider]) {
    const preset = _presets.tts[provider];
    if (preset.default_api_base && provider === 'gpt_sovits') {
      const cur = document.getElementById('tts-api-base').value;
      if (!cur) document.getElementById('tts-api-base').value = preset.default_api_base;
    }
  }
}

async function saveTTSSettings() {
  const data = {
    provider: document.getElementById('tts-provider').value,
    api_base: document.getElementById('tts-api-base').value,
    api_key: document.getElementById('tts-api-key').value,
    edge_voice: document.getElementById('tts-edge-voice').value,
    default_voice: document.getElementById('tts-default-voice').value,
    timeout: parseInt(document.getElementById('tts-timeout').value),
  };
  try {
    const result = await api('/api/settings/tts', {
      method: 'PUT', body: { section: 'tts', data },
    });
    if (result.success) {
      toast('TTS 配置已保存', 'success');
      _currentSettings = await api('/api/settings');
      updateModelStatusBadges();
    } else {
      toast(`保存失败: ${result.message}`, 'error');
    }
  } catch (e) {
    toast(`保存失败: ${e.message}`, 'error');
  }
}

async function resetTTSSettings() {
  if (!confirm('确定重置 TTS 配置为默认？')) return;
  try {
    await api('/api/settings/tts', { method: 'DELETE' });
    toast('已重置', 'success');
    await loadAllSettings();
  } catch (e) {
    toast(`重置失败: ${e.message}`, 'error');
  }
}

async function testTTSConnection() {
  const payload = {
    provider: document.getElementById('tts-provider').value,
    api_base: document.getElementById('tts-api-base').value,
    api_key: document.getElementById('tts-api-key').value,
  };
  const btn = document.getElementById('tts-test-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 测试中...';
  try {
    const result = await api('/api/settings/test/tts', { method: 'POST', body: payload });
    showTestResult('tts-test-result', result);
    toast(result.success ? '连接成功' : '连接失败', result.success ? 'success' : 'error');
  } catch (e) {
    showTestResult('tts-test-result', { success: false, message: e.message });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔌 测试连接';
  }
}

// ========== ASR 配置 ==========

function loadASRSettings() {
  if (!_currentSettings) return;
  const asr = _currentSettings.asr || {};
  document.getElementById('asr-provider').value = asr.provider || 'mock';
  document.getElementById('asr-model').value = asr.model || 'paraformer-zh';
  document.getElementById('asr-language').value = asr.language || 'zh';
  const subtitle = asr.subtitle || {};
  document.getElementById('asr-max-chars').value = subtitle.max_chars_per_line || 18;
}

async function saveASRSettings() {
  const data = {
    provider: document.getElementById('asr-provider').value,
    model: document.getElementById('asr-model').value,
    language: document.getElementById('asr-language').value,
    subtitle: {
      max_chars_per_line: parseInt(document.getElementById('asr-max-chars').value),
    },
  };
  try {
    const result = await api('/api/settings/asr', {
      method: 'PUT', body: { section: 'asr', data },
    });
    toast(result.success ? 'ASR 配置已保存' : `保存失败: ${result.message}`,
          result.success ? 'success' : 'error');
  } catch (e) {
    toast(`保存失败: ${e.message}`, 'error');
  }
}

async function resetASRSettings() {
  if (!confirm('确定重置 ASR 配置为默认？')) return;
  try {
    await api('/api/settings/asr', { method: 'DELETE' });
    toast('已重置', 'success');
    await loadAllSettings();
  } catch (e) {
    toast(`重置失败: ${e.message}`, 'error');
  }
}

// ========== 数字人配置 ==========

function loadAvatarSettings() {
  if (!_currentSettings) return;
  const avatar = _currentSettings.avatar || {};
  document.getElementById('avatar-provider').value = avatar.provider || 'mock';
  onAvatarProviderChange();
  document.getElementById('avatar-default').value = avatar.default_avatar || 'default';
  document.getElementById('avatar-api-base').value = avatar.api_base || '';
  document.getElementById('avatar-fps').value = avatar.output_fps || 25;
  document.getElementById('avatar-timeout').value = avatar.timeout || 300;
  const res = avatar.output_resolution || [1080, 1920];
  document.getElementById('avatar-res-w').value = res[0];
  document.getElementById('avatar-res-h').value = res[1];
}

function onAvatarProviderChange() {
  const provider = document.getElementById('avatar-provider').value;
  const apiBaseGroup = document.getElementById('avatar-api-base-group');
  apiBaseGroup.style.display = provider === 'mock' ? 'none' : 'block';
  // 自动填充默认地址
  if (_presets && _presets.avatar[provider]) {
    const preset = _presets.avatar[provider];
    if (preset.default_api_base && provider !== 'mock') {
      const cur = document.getElementById('avatar-api-base').value;
      if (!cur) document.getElementById('avatar-api-base').value = preset.default_api_base;
    }
  }
}

function onAvatarResPresetChange(val) {
  if (!val) return;
  const [w, h] = val.split('x');
  document.getElementById('avatar-res-w').value = w;
  document.getElementById('avatar-res-h').value = h;
}

async function saveAvatarSettings() {
  const data = {
    provider: document.getElementById('avatar-provider').value,
    default_avatar: document.getElementById('avatar-default').value,
    api_base: document.getElementById('avatar-api-base').value,
    output_fps: parseInt(document.getElementById('avatar-fps').value),
    timeout: parseInt(document.getElementById('avatar-timeout').value),
    output_resolution: [
      parseInt(document.getElementById('avatar-res-w').value),
      parseInt(document.getElementById('avatar-res-h').value),
    ],
  };
  try {
    const result = await api('/api/settings/avatar', {
      method: 'PUT', body: { section: 'avatar', data },
    });
    if (result.success) {
      toast('数字人配置已保存', 'success');
      _currentSettings = await api('/api/settings');
      updateModelStatusBadges();
    } else {
      toast(`保存失败: ${result.message}`, 'error');
    }
  } catch (e) {
    toast(`保存失败: ${e.message}`, 'error');
  }
}

async function resetAvatarSettings() {
  if (!confirm('确定重置数字人配置为默认？')) return;
  try {
    await api('/api/settings/avatar', { method: 'DELETE' });
    toast('已重置', 'success');
    await loadAllSettings();
  } catch (e) {
    toast(`重置失败: ${e.message}`, 'error');
  }
}

async function testAvatarConnection() {
  const payload = {
    provider: document.getElementById('avatar-provider').value,
    api_base: document.getElementById('avatar-api-base').value,
  };
  const btn = document.getElementById('avatar-test-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 测试中...';
  try {
    const result = await api('/api/settings/test/avatar', { method: 'POST', body: payload });
    showTestResult('avatar-test-result', result);
    toast(result.success ? '连接成功' : '连接失败', result.success ? 'success' : 'error');
  } catch (e) {
    showTestResult('avatar-test-result', { success: false, message: e.message });
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔌 测试连接';
  }
}

// ========== 视频设置 ==========

async function loadVideoSettings() {
  if (!_currentSettings) {
    _currentSettings = await api('/api/settings');
  }
  const asr = _currentSettings.asr || {};
  const subtitle = asr.subtitle || {};
  const composer = _currentSettings.composer || {};
  const cover = _currentSettings.cover || {};

  // 字幕
  document.getElementById('sub-font-size').value = subtitle.font_size || 24;
  document.getElementById('sub-max-chars').value = subtitle.max_chars_per_line || 18;
  // ASS 颜色转换 &HFFFFFF -> #FFFFFF
  const fontColor = (subtitle.font_color || '&HFFFFFF').replace('&H', '#');
  document.getElementById('sub-font-color').value = fontColor.length === 7 ? fontColor : '#FFFFFF';
  const outlineColor = (subtitle.outline_color || '&H000000').replace('&H', '#');
  document.getElementById('sub-outline-color').value = outlineColor.length === 7 ? outlineColor : '#000000';
  document.getElementById('sub-outline-width').value = subtitle.outline_width || 2;

  // BGM
  document.getElementById('bgm-volume').value = composer.bgm_volume ?? 0.15;
  document.getElementById('bgm-vol-val').textContent = composer.bgm_volume ?? 0.15;
  document.getElementById('bgm-dir').value = composer.bgm_dir || './config/bgm';

  // 视频输出
  document.getElementById('video-fps').value = composer.output_fps || 30;
  document.getElementById('video-bitrate').value = composer.video_bitrate || '8M';
  document.getElementById('audio-bitrate').value = composer.audio_bitrate || '192k';
  const res = composer.output_resolution || [1080, 1920];
  document.getElementById('video-ratio').value = `${res[0]}x${res[1]}`;
  document.getElementById('ffmpeg-path').value = composer.ffmpeg_path || 'ffmpeg';

  // 封面
  document.getElementById('cover-mode').value = cover.mode || 'frame_overlay';
  document.getElementById('cover-max-chars').value = cover.title_max_chars || 20;
  document.getElementById('cover-font-path').value = cover.font_path || './config/fonts/SourceHanSansCN-Bold.otf';
}

function onVideoRatioChange(val) {
  if (!val) return;
  // 仅用于显示提示，实际分辨率在保存时写入
}

async function saveVideoSettings() {
  // 字幕颜色转回 ASS 格式
  const fontColor = '&H' + document.getElementById('sub-font-color').value.replace('#', '').toUpperCase();
  const outlineColor = '&H' + document.getElementById('sub-outline-color').value.replace('#', '').toUpperCase();
  const maxChars = parseInt(document.getElementById('sub-max-chars').value);

  // ASR 段（字幕样式）
  const asrData = {
    subtitle: {
      font_size: parseInt(document.getElementById('sub-font-size').value),
      font_color: fontColor,
      outline_color: outlineColor,
      outline_width: parseFloat(document.getElementById('sub-outline-width').value),
      max_chars_per_line: maxChars,
    },
  };
  // Composer 段
  const ratio = document.getElementById('video-ratio').value.split('x');
  const composerData = {
    ffmpeg_path: document.getElementById('ffmpeg-path').value,
    output_fps: parseInt(document.getElementById('video-fps').value),
    output_resolution: [parseInt(ratio[0]), parseInt(ratio[1])],
    video_bitrate: document.getElementById('video-bitrate').value,
    audio_bitrate: document.getElementById('audio-bitrate').value,
    bgm_dir: document.getElementById('bgm-dir').value,
    bgm_volume: parseFloat(document.getElementById('bgm-volume').value),
  };
  // Cover 段
  const coverData = {
    mode: document.getElementById('cover-mode').value,
    title_max_chars: parseInt(document.getElementById('cover-max-chars').value),
    font_path: document.getElementById('cover-font-path').value,
  };

  try {
    await api('/api/settings/asr', { method: 'PUT', body: { section: 'asr', data: asrData } });
    await api('/api/settings/composer', { method: 'PUT', body: { section: 'composer', data: composerData } });
    await api('/api/settings/cover', { method: 'PUT', body: { section: 'cover', data: coverData } });
    toast('视频设置已保存', 'success');
    _currentSettings = await api('/api/settings');
  } catch (e) {
    toast(`保存失败: ${e.message}`, 'error');
  }
}

async function resetVideoSettings() {
  if (!confirm('确定重置视频设置为默认？')) return;
  try {
    await api('/api/settings/asr', { method: 'DELETE' });
    await api('/api/settings/composer', { method: 'DELETE' });
    await api('/api/settings/cover', { method: 'DELETE' });
    toast('已重置', 'success');
    _currentSettings = await api('/api/settings');
    loadVideoSettings();
  } catch (e) {
    toast(`重置失败: ${e.message}`, 'error');
  }
}

// ========== 发布设置 ==========

const PLATFORM_INFO = {
  bilibili: { name: '哔哩哔哩', icon: '📺', method: 'api' },
  douyin: { name: '抖音', icon: '🎵', method: 'playwright' },
  kuaishou: { name: '快手', icon: '⚡', method: 'playwright' },
  wechat_video: { name: '微信视频号', icon: '💬', method: 'playwright' },
};

async function loadPublishSettings() {
  if (!_currentSettings) {
    _currentSettings = await api('/api/settings');
  }
  const pub = _currentSettings.publisher || {};
  document.getElementById('pub-mode').value = pub.mode || 'semi_auto';
  document.getElementById('pub-interval').value = pub.publish_interval || 60;

  // 渲染平台卡片
  const listEl = document.getElementById('platform-list');
  const platforms = pub.platforms || {};
  listEl.innerHTML = Object.entries(PLATFORM_INFO).map(([key, info]) => {
    const conf = platforms[key] || {};
    const enabled = conf.enabled !== false;
    return `
      <div class="platform-card" data-platform="${key}">
        <div class="platform-card-header">
          <div class="platform-name">
            <span class="platform-icon">${info.icon}</span>
            <span>${info.name}</span>
          </div>
          <div class="platform-toggle ${enabled ? 'active' : ''}" onclick="togglePlatform('${key}', this)"></div>
        </div>
        <div class="platform-meta">
          <div class="platform-meta-row">
            <span>发布方式</span>
            <span>${conf.method || info.method}</span>
          </div>
          <div class="platform-meta-row">
            <span>API 地址</span>
            <span>${conf.api_base || '默认'}</span>
          </div>
          <div class="platform-meta-row">
            <span>登录状态</span>
            <span class="badge ${enabled ? 'badge-success' : 'badge-muted'}">${enabled ? '已启用' : '未启用'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function togglePlatform(key, el) {
  el.classList.toggle('active');
}

async function savePublishSettings() {
  const mode = document.getElementById('pub-mode').value;
  const interval = parseInt(document.getElementById('pub-interval').value);

  // 收集平台启用状态
  const platforms = {};
  document.querySelectorAll('.platform-card').forEach(card => {
    const key = card.dataset.platform;
    const toggle = card.querySelector('.platform-toggle');
    platforms[key] = {
      enabled: toggle.classList.contains('active'),
      method: PLATFORM_INFO[key].method,
    };
    if (key === 'bilibili') {
      platforms[key].api_base = 'https://api.bilibili.com';
    }
  });

  const data = {
    mode,
    publish_interval: interval,
    platforms,
  };
  try {
    const result = await api('/api/settings/publisher', {
      method: 'PUT', body: { section: 'publisher', data },
    });
    toast(result.success ? '发布设置已保存' : `保存失败: ${result.message}`,
          result.success ? 'success' : 'error');
    if (result.success) {
      _currentSettings = await api('/api/settings');
      loadPublishSettings();
    }
  } catch (e) {
    toast(`保存失败: ${e.message}`, 'error');
  }
}

async function resetPublishSettings() {
  if (!confirm('确定重置发布设置为默认？')) return;
  try {
    await api('/api/settings/publisher', { method: 'DELETE' });
    toast('已重置', 'success');
    _currentSettings = await api('/api/settings');
    loadPublishSettings();
  } catch (e) {
    toast(`重置失败: ${e.message}`, 'error');
  }
}

// ========== 绑定设置按钮 ==========

document.addEventListener('DOMContentLoaded', () => {
  // LLM
  document.getElementById('llm-save-btn')?.addEventListener('click', saveLLMSettings);
  document.getElementById('llm-reset-btn')?.addEventListener('click', resetLLMSettings);
  document.getElementById('llm-test-btn')?.addEventListener('click', testLLMConnection);
  document.getElementById('llm-toggle-key')?.addEventListener('click', () => {
    const input = document.getElementById('llm-api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  // TTS
  document.getElementById('tts-save-btn')?.addEventListener('click', saveTTSSettings);
  document.getElementById('tts-reset-btn')?.addEventListener('click', resetTTSSettings);
  document.getElementById('tts-test-btn')?.addEventListener('click', testTTSConnection);
  // ASR
  document.getElementById('asr-save-btn')?.addEventListener('click', saveASRSettings);
  document.getElementById('asr-reset-btn')?.addEventListener('click', resetASRSettings);
  // Avatar
  document.getElementById('avatar-save-btn')?.addEventListener('click', saveAvatarSettings);
  document.getElementById('avatar-reset-btn')?.addEventListener('click', resetAvatarSettings);
  document.getElementById('avatar-test-btn')?.addEventListener('click', testAvatarConnection);
  // Video
  document.getElementById('video-save-btn')?.addEventListener('click', saveVideoSettings);
  document.getElementById('video-reset-btn')?.addEventListener('click', resetVideoSettings);
  // Publish
  document.getElementById('publish-save-btn')?.addEventListener('click', savePublishSettings);
  document.getElementById('publish-reset-btn')?.addEventListener('click', resetPublishSettings);
});
