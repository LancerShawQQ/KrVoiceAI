/**
 * KrVoiceAI Web App
 * 前端交互逻辑
 */

const API_BASE = '';

// ========== 工具函数 ==========

async function api(path, options = {}) {
  const url = API_BASE + path;
  const opts = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.body = JSON.stringify(opts.body);
  }
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span style="font-size:18px">${icons[type] || ''}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function formatTime(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function statusBadge(status) {
  const map = {
    success: ['badge-success', '成功'],
    failed: ['badge-error', '失败'],
    running: ['badge-info', '运行中'],
    pending: ['badge-warning', '等待中'],
    skipped: ['badge-muted', '跳过'],
    cancelled: ['badge-muted', '已取消'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ========== 页面导航 ==========

const PAGES = [
  'generate', 'script', 'step-by-step', 'batch',
  'avatars', 'voices', 'jobs',
  'settings-models', 'settings-video', 'settings-publish',
  'health',
];

function navigate(page) {
  PAGES.forEach(p => {
    const pageEl = document.getElementById(`page-${p}`);
    const navEl = document.getElementById(`nav-${p}`);
    if (pageEl) pageEl.classList.remove('active');
    if (navEl) navEl.classList.remove('active');
  });
  const targetPage = document.getElementById(`page-${page}`);
  const targetNav = document.getElementById(`nav-${page}`);
  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');

  // 页面加载时刷新数据
  if (page === 'jobs') loadJobs();
  if (page === 'avatars') loadAvatars();
  if (page === 'voices') loadVoices();
  if (page === 'health') loadHealth();
  if (page === 'generate') { loadAvatarsForSelect(); loadVoicesForSelect(); }
  if (page === 'step-by-step') { loadAvatarsForSelect2(); loadVoicesForSelect2(); }
  if (page === 'batch') { loadAvatarsForSelect3(); loadVoicesForSelect3(); }
  if (page === 'settings-models') loadAllSettings();
  if (page === 'settings-video') loadVideoSettings();
  if (page === 'settings-publish') loadPublishSettings();
}

// ========== 一键生成页面 ==========

const STEP_INFO = {
  script_extract: { name: '文案提取', icon: '📝' },
  script_write: { name: '文案仿写', icon: '✍️' },
  tts: { name: '语音合成', icon: '🎙️' },
  avatar: { name: '数字人生成', icon: '👤' },
  subtitle: { name: '字幕生成', icon: '💬' },
  compose: { name: '视频合成', icon: '🎬' },
  title: { name: '标题生成', icon: '📌' },
  cover: { name: '封面生成', icon: '🖼️' },
  publish: { name: '多平台发布', icon: '📤' },
};

const STEP_ORDER = ['script_extract', 'script_write', 'tts', 'avatar', 'subtitle', 'compose', 'title', 'cover', 'publish'];

function renderPipeline(stepsState = {}) {
  const container = document.getElementById('pipeline');
  container.innerHTML = STEP_ORDER.map(step => {
    const info = STEP_INFO[step];
    const status = stepsState[step] || 'pending';
    const icons = {
      pending: '○', running: '⟳', success: '✓', failed: '✕', skipped: '−',
    };
    const statusText = {
      pending: '等待中', running: '执行中...', success: '已完成', failed: '失败', skipped: '已跳过',
    };
    return `
      <div class="pipeline-step ${status}">
        <div class="step-icon">${icons[status] || '○'}</div>
        <div class="step-info">
          <div class="step-name">${info.icon} ${info.name}</div>
          <div class="step-status">${statusText[status] || status}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadAvatarsForSelect() {
  try {
    const avatars = await api('/api/avatars');
    const select = document.getElementById('gen-avatar');
    const ids = avatars.length ? avatars.map(a => a.avatar_id) : ['default'];
    select.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
  } catch (e) { /* 忽略 */ }
}

async function loadVoicesForSelect() {
  try {
    const voices = await api('/api/voices');
    const select = document.getElementById('gen-voice');
    const ids = voices.length ? voices.map(v => v.voice_id) : ['default'];
    select.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
  } catch (e) { /* 忽略 */ }
}

async function handleGenerate() {
  const script = document.getElementById('gen-script').value.trim();
  const refUrl = document.getElementById('gen-ref-url').value.trim();
  const avatar = document.getElementById('gen-avatar').value;
  const voice = document.getElementById('gen-voice').value;
  const mode = document.getElementById('gen-mode').value;
  const platform = document.getElementById('gen-platform').value;
  const autoPublish = document.getElementById('gen-publish').checked;

  if (!script && !refUrl) {
    toast('请输入文案或参考视频链接', 'error');
    return;
  }

  const btn = document.getElementById('gen-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 生成中...';

  // 初始进度展示
  renderPipeline({});

  try {
    const result = await api('/api/generate', {
      method: 'POST',
      body: {
        script, reference_video_url: refUrl || null,
        avatar_id: avatar, voice_id: voice,
        script_mode: mode, platform, auto_publish: autoPublish,
      },
    });

    // 从 steps 构建进度状态
    const stepsState = {};
    if (result.steps) {
      for (const [name, info] of Object.entries(result.steps)) {
        stepsState[name] = info.status;
      }
    }
    renderPipeline(stepsState);

    // 展示结果
    const output = result.output || {};
    const videoPath = output.final_video;
    const title = output.title || '';
    const coverPath = output.cover;
    const scriptText = output.script_text || '';

    // 视频
    const videoEl = document.getElementById('result-video');
    if (videoPath) {
      videoEl.innerHTML = `<video src="/api/files?path=${encodeURIComponent(videoPath)}" controls autoplay></video>`;
    } else {
      videoEl.innerHTML = '<div class="result-video-placeholder">视频未生成</div>';
    }

    // 标题
    document.getElementById('result-title').textContent = title || '—';

    // 封面
    const coverEl = document.getElementById('result-cover');
    if (coverPath) {
      coverEl.innerHTML = `<img class="meta-image" src="/api/files?path=${encodeURIComponent(coverPath)}" alt="封面">`;
    } else {
      coverEl.innerHTML = '<span class="meta-value">—</span>';
    }

    // 文案
    document.getElementById('result-script').textContent = scriptText || '—';

    // 详情
    document.getElementById('result-detail').textContent = JSON.stringify(result, null, 2);

    toast(result.success ? '视频生成成功！' : '生成未完全成功', result.success ? 'success' : 'error');
  } catch (e) {
    toast(`生成失败: ${e.message}`, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🚀 开始生成视频';
  }
}

// ========== 分步创作页面 ==========

async function loadAvatarsForSelect2() {
  try {
    const avatars = await api('/api/avatars');
    const select = document.getElementById('step-avatar');
    const ids = avatars.length ? avatars.map(a => a.avatar_id) : ['default'];
    select.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
  } catch (e) { /* 忽略 */ }
}

async function loadVoicesForSelect2() {
  try {
    const voices = await api('/api/voices');
    const select = document.getElementById('step-voice');
    const ids = voices.length ? voices.map(v => v.voice_id) : ['default'];
    select.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
  } catch (e) { /* 忽略 */ }
}

async function handleRunModule() {
  const script = document.getElementById('step-script').value.trim();
  const refUrl = document.getElementById('step-ref-url').value.trim();
  const avatar = document.getElementById('step-avatar').value;
  const voice = document.getElementById('step-voice').value;
  const mode = document.getElementById('step-mode').value;
  const platform = document.getElementById('step-platform').value;
  const moduleName = document.getElementById('step-module').value;

  if (!script && !refUrl) {
    toast('请输入文案或参考视频链接', 'error');
    return;
  }

  const btn = document.getElementById('step-run-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 执行中...';

  try {
    const result = await api('/api/module/run', {
      method: 'POST',
      body: {
        module_name: moduleName, script,
        reference_video_url: refUrl || null,
        avatar_id: avatar, voice_id: voice,
        script_mode: mode, platform,
      },
    });

    document.getElementById('step-result').textContent = JSON.stringify(result, null, 2);

    // 展示音频/视频产物
    const ctx = result.context || {};
    const audioEl = document.getElementById('step-audio');
    const videoEl = document.getElementById('step-video');

    if (ctx.audio_path) {
      audioEl.innerHTML = `<audio src="/api/files?path=${encodeURIComponent(ctx.audio_path)}" controls style="width:100%"></audio>`;
    } else {
      audioEl.innerHTML = '<span style="color:var(--text-muted)">无音频产物</span>';
    }

    const videoPath = ctx.raw_video_path || ctx.final_video;
    if (videoPath) {
      videoEl.innerHTML = `<video src="/api/files?path=${encodeURIComponent(videoPath)}" controls style="width:100%;border-radius:10px"></video>`;
    } else {
      videoEl.innerHTML = '<span style="color:var(--text-muted)">无视频产物</span>';
    }

    toast(result.success ? `模块 ${moduleName} 执行成功` : `模块 ${moduleName} 执行失败`, result.success ? 'success' : 'error');
  } catch (e) {
    toast(`执行失败: ${e.message}`, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶️ 执行此模块';
  }
}

// ========== 任务管理页面 ==========

async function loadJobs() {
  try {
    const jobs = await api('/api/jobs?limit=50');
    const tbody = document.getElementById('jobs-tbody');
    if (!jobs.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted)">暂无任务</td></tr>';
      return;
    }
    tbody.innerHTML = jobs.map(j => `
      <tr>
        <td style="font-family:var(--font-mono);font-size:12px">${j.job_id}</td>
        <td>${statusBadge(j.status)}</td>
        <td>${formatTime(j.created_at)}</td>
        <td>${formatTime(j.updated_at)}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="showJobDetail('${j.job_id}')">详情</button>
          <button class="btn btn-sm btn-secondary" onclick="rerunJob('${j.job_id}')">续跑</button>
          <button class="btn btn-sm btn-danger" onclick="deleteJob('${j.job_id}')">删除</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    toast(`加载任务失败: ${e.message}`, 'error');
  }
}

async function showJobDetail(jobId) {
  try {
    const job = await api(`/api/jobs/${jobId}`);
    const detail = document.getElementById('job-detail');
    const stepsHtml = (job.steps || []).map(s => `
      <div class="pipeline-step ${s.status}">
        <div class="step-icon">${STEP_INFO[s.step]?.icon || '○'}</div>
        <div class="step-info">
          <div class="step-name">${STEP_INFO[s.step]?.name || s.step}</div>
          <div class="step-status">${s.status} ${s.duration ? `· ${s.duration.toFixed(2)}s` : ''}</div>
        </div>
      </div>
    `).join('');
    detail.innerHTML = `
      <div style="margin-bottom:16px">
        <strong>任务 ID:</strong> ${job.job_id}<br>
        <strong>状态:</strong> ${statusBadge(job.status)}<br>
        <strong>创建时间:</strong> ${formatTime(job.created_at)}
      </div>
      <div class="pipeline">${stepsHtml}</div>
      ${job.error ? `<div style="margin-top:12px;color:var(--color-error)">错误: ${job.error}</div>` : ''}
    `;
  } catch (e) {
    toast(`加载详情失败: ${e.message}`, 'error');
  }
}

async function rerunJob(jobId) {
  if (!confirm(`确定要续跑任务 ${jobId} 吗？`)) return;
  try {
    toast('正在续跑任务...', 'info');
    const result = await api(`/api/jobs/${jobId}/rerun`, { method: 'POST' });
    toast(result.success ? '续跑成功' : '续跑失败', result.success ? 'success' : 'error');
    loadJobs();
  } catch (e) {
    toast(`续跑失败: ${e.message}`, 'error');
  }
}

async function deleteJob(jobId) {
  if (!confirm(`确定要删除任务 ${jobId} 吗？此操作不可撤销。`)) return;
  try {
    await api(`/api/jobs/${jobId}`, { method: 'DELETE' });
    toast('任务已删除', 'success');
    loadJobs();
  } catch (e) {
    toast(`删除失败: ${e.message}`, 'error');
  }
}

// ========== 形象管理页面 ==========

async function loadAvatars() {
  try {
    const avatars = await api('/api/avatars');
    const grid = document.getElementById('avatars-grid');
    if (!avatars.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👤</div><div>暂无已注册形象</div></div>';
      return;
    }
    grid.innerHTML = avatars.map(a => `
      <div class="asset-card">
        <div class="asset-id">${a.avatar_id}</div>
        <div class="asset-meta">${a.meta?.mode || 'mock'} 模式</div>
      </div>
    `).join('');
  } catch (e) {
    toast(`加载形象失败: ${e.message}`, 'error');
  }
}

async function handleRegisterAvatar() {
  const avatarId = document.getElementById('avatar-id').value.trim();
  const fileInput = document.getElementById('avatar-file');
  if (!avatarId) { toast('请输入形象 ID', 'error'); return; }
  if (!fileInput.files.length) { toast('请选择参考视频', 'error'); return; }

  const formData = new FormData();
  formData.append('avatar_id', avatarId);
  formData.append('file', fileInput.files[0]);

  const btn = document.getElementById('avatar-reg-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 注册中...';

  try {
    const resp = await fetch('/api/avatars/register', { method: 'POST', body: formData });
    const result = await resp.json();
    toast(result.success ? '形象注册成功' : '注册失败', result.success ? 'success' : 'error');
    if (result.success) {
      document.getElementById('avatar-id').value = '';
      fileInput.value = '';
      loadAvatars();
    }
  } catch (e) {
    toast(`注册失败: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📥 注册形象';
  }
}

// ========== 音色管理页面 ==========

async function loadVoices() {
  try {
    const voices = await api('/api/voices');
    const grid = document.getElementById('voices-grid');
    if (!voices.length) {
      grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎙️</div><div>暂无已注册音色</div></div>';
      return;
    }
    grid.innerHTML = voices.map(v => `
      <div class="asset-card">
        <div class="asset-id">${v.voice_id}</div>
        <div class="asset-meta">已注册</div>
      </div>
    `).join('');
  } catch (e) {
    toast(`加载音色失败: ${e.message}`, 'error');
  }
}

async function handleRegisterVoice() {
  const voiceId = document.getElementById('voice-id').value.trim();
  const fileInput = document.getElementById('voice-file');
  if (!voiceId) { toast('请输入音色 ID', 'error'); return; }
  if (!fileInput.files.length) { toast('请选择样本音频', 'error'); return; }

  const formData = new FormData();
  formData.append('voice_id', voiceId);
  formData.append('file', fileInput.files[0]);

  const btn = document.getElementById('voice-reg-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 注册中...';

  try {
    const resp = await fetch('/api/voices/register', { method: 'POST', body: formData });
    const result = await resp.json();
    toast(result.success ? '音色注册成功' : '注册失败', result.success ? 'success' : 'error');
    if (result.success) {
      document.getElementById('voice-id').value = '';
      fileInput.value = '';
      loadVoices();
    }
  } catch (e) {
    toast(`注册失败: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📥 注册音色';
  }
}

// ========== 系统状态页面 ==========

async function loadHealth() {
  try {
    const health = await api('/api/health');
    const container = document.getElementById('health-content');
    const items = [
      { key: 'ffmpeg', label: 'FFmpeg 视频处理', icon: '🎬' },
      { key: 'gpu_tts', label: '云端 TTS 服务', icon: '🎙️' },
      { key: 'gpu_avatar', label: '云端数字人服务', icon: '👤' },
      { key: 'llm_mock', label: 'LLM 模式', icon: '🧠' },
      { key: 'avatars_count', label: '已注册形象', icon: '👥' },
      { key: 'voices_count', label: '已注册音色', icon: '🎵' },
    ];
    container.innerHTML = items.map(item => {
      const val = health[item.key];
      let display;
      if (typeof val === 'boolean') {
        display = val
          ? '<span class="badge badge-success">可用</span>'
          : '<span class="badge badge-error">不可用</span>';
      } else if (item.key === 'llm_mock') {
        display = val
          ? '<span class="badge badge-warning">Mock 模式</span>'
          : '<span class="badge badge-success">真实 API</span>';
      } else {
        display = `<span class="badge badge-info">${val}</span>`;
      }
      return `
        <div class="card" style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:14px">
            <span style="font-size:24px">${item.icon}</span>
            <span style="font-weight:600">${item.label}</span>
          </div>
          ${display}
        </div>
      `;
    }).join('');

    // 更新侧边栏状态
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (health.ffmpeg) {
      dot.classList.remove('offline');
      text.textContent = '系统正常';
    } else {
      dot.classList.add('offline');
      text.textContent = '系统异常';
    }
  } catch (e) {
    toast(`健康检查失败: ${e.message}`, 'error');
  }
}

// ========== 文案工作台页面 ==========

let currentScriptAction = 'polish';

async function loadAvatarsForSelect3() {
  try {
    const avatars = await api('/api/avatars');
    const select = document.getElementById('batch-avatar');
    if (!select) return;
    const ids = avatars.length ? avatars.map(a => a.avatar_id) : ['default'];
    select.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
  } catch (e) { /* 忽略 */ }
}

async function loadVoicesForSelect3() {
  try {
    const voices = await api('/api/voices');
    const select = document.getElementById('batch-voice');
    if (!select) return;
    const ids = voices.length ? voices.map(v => v.voice_id) : ['default'];
    select.innerHTML = ids.map(id => `<option value="${id}">${id}</option>`).join('');
  } catch (e) { /* 忽略 */ }
}

function selectScriptAction(action) {
  currentScriptAction = action;
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.action === action);
  });
  // 显示/隐藏附加输入
  document.getElementById('topic-input-group').style.display = action === 'generate' ? 'block' : 'none';
  document.getElementById('style-input-group').style.display = action === 'style' ? 'block' : 'none';
}

async function handleScriptProcess() {
  const script = document.getElementById('script-input').value.trim();
  const topic = document.getElementById('script-topic').value.trim();
  const style = document.getElementById('script-style').value;
  const action = currentScriptAction;

  if (action !== 'generate' && !script) {
    toast('请输入文案', 'error');
    return;
  }
  if (action === 'generate' && !topic && !script) {
    toast('请输入创作主题', 'error');
    return;
  }

  const btn = document.getElementById('script-process-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI 处理中...';

  try {
    const result = await api('/api/script/process', {
      method: 'POST',
      body: { script, action, style: action === 'style' ? style : null, topic: action === 'generate' ? topic : null },
    });

    if (result.success) {
      document.getElementById('script-output').value = result.script;
      document.getElementById('script-output-count').textContent = `${result.char_count} 字`;
      toast(`处理成功${result.mock ? '（Mock 模式）' : ''}`, 'success');
    } else {
      toast(`处理失败: ${result.error}`, 'error');
    }
  } catch (e) {
    toast(`处理失败: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶️ 执行 AI 处理';
  }
}

function handleScriptCopy() {
  const output = document.getElementById('script-output');
  if (!output.value) {
    toast('暂无内容可复制', 'error');
    return;
  }
  output.select();
  document.execCommand('copy');
  toast('已复制到剪贴板', 'success');
}

function handleScriptToGenerate() {
  const output = document.getElementById('script-output').value;
  if (!output) {
    toast('暂无文案，请先处理', 'error');
    return;
  }
  document.getElementById('gen-script').value = output;
  navigate('generate');
  toast('已填入文案，可点击「开始生成视频」', 'info');
}

function handleScriptClear() {
  document.getElementById('script-input').value = '';
  document.getElementById('script-output').value = '';
  document.getElementById('script-topic').value = '';
  document.getElementById('script-char-count').textContent = '0 字';
  document.getElementById('script-output-count').textContent = '0 字';
}

// ========== 批量处理页面 ==========

async function handleBatchGenerate() {
  const scriptsText = document.getElementById('batch-scripts').value.trim();
  if (!scriptsText) {
    toast('请输入文案', 'error');
    return;
  }

  // 按空行分割
  const scripts = scriptsText.split(/\n\s*\n/).map(s => s.trim()).filter(s => s);
  if (scripts.length === 0) {
    toast('未识别到有效文案', 'error');
    return;
  }

  const avatar = document.getElementById('batch-avatar').value;
  const voice = document.getElementById('batch-voice').value;
  const mode = document.getElementById('batch-mode').value;
  const platform = document.getElementById('batch-platform').value;

  const btn = document.getElementById('batch-run-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 批量生成中...';

  // 初始化进度列表
  const listEl = document.getElementById('batch-progress-list');
  const badgeEl = document.getElementById('batch-progress-badge');
  badgeEl.textContent = `0 / ${scripts.length}`;
  listEl.innerHTML = scripts.map((s, i) => `
    <div class="batch-item" id="batch-item-${i}">
      <div class="batch-item-index">${i + 1}</div>
      <div class="batch-item-content">
        <div class="batch-item-text">${s.substring(0, 60)}${s.length > 60 ? '...' : ''}</div>
        <div class="batch-item-meta">等待中...</div>
      </div>
    </div>
  `).join('');

  try {
    const items = scripts.map(s => ({
      script: s, avatar_id: avatar, voice_id: voice,
      script_mode: mode, platform, auto_publish: false,
    }));

    // 逐条提交并更新进度
    let completed = 0;
    for (let i = 0; i < items.length; i++) {
      const itemEl = document.getElementById(`batch-item-${i}`);
      itemEl.classList.add('running');
      itemEl.querySelector('.batch-item-meta').textContent = '生成中...';

      try {
        const result = await api('/api/generate', { method: 'POST', body: items[i] });
        completed++;
        badgeEl.textContent = `${completed} / ${scripts.length}`;
        if (result.success) {
          itemEl.classList.remove('running');
          itemEl.classList.add('success');
          const videoPath = result.output?.final_video || '';
          itemEl.querySelector('.batch-item-meta').innerHTML = `✅ 成功 · ${videoPath ? `<a href="/api/files?path=${encodeURIComponent(videoPath)}" target="_blank">查看视频</a>` : ''}`;
        } else {
          itemEl.classList.remove('running');
          itemEl.classList.add('failed');
          itemEl.querySelector('.batch-item-meta').textContent = `❌ 失败: ${result.error || '未知错误'}`;
        }
      } catch (e) {
        itemEl.classList.remove('running');
        itemEl.classList.add('failed');
        itemEl.querySelector('.batch-item-meta').textContent = `❌ 异常: ${e.message}`;
      }
    }

    const successCount = document.querySelectorAll('.batch-item.success').length;
    toast(`批量完成：${successCount}/${scripts.length} 成功`, successCount === scripts.length ? 'success' : 'info');
  } catch (e) {
    toast(`批量处理失败: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📦 开始批量生成';
  }
}

// ========== 初始化 ==========

document.addEventListener('DOMContentLoaded', () => {
  // 导航绑定
  PAGES.forEach(p => {
    const nav = document.getElementById(`nav-${p}`);
    if (nav) nav.addEventListener('click', () => navigate(p));
  });

  // 按钮绑定
  document.getElementById('gen-btn').addEventListener('click', handleGenerate);
  document.getElementById('step-run-btn').addEventListener('click', handleRunModule);
  document.getElementById('avatar-reg-btn').addEventListener('click', handleRegisterAvatar);
  document.getElementById('voice-reg-btn').addEventListener('click', handleRegisterVoice);
  document.getElementById('refresh-jobs-btn').addEventListener('click', loadJobs);
  document.getElementById('refresh-health-btn').addEventListener('click', loadHealth);

  // 文案工作台
  document.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => selectScriptAction(btn.dataset.action));
  });
  document.getElementById('script-process-btn').addEventListener('click', handleScriptProcess);
  document.getElementById('script-copy-btn').addEventListener('click', handleScriptCopy);
  document.getElementById('script-to-generate-btn').addEventListener('click', handleScriptToGenerate);
  document.getElementById('script-clear-btn').addEventListener('click', handleScriptClear);
  document.getElementById('script-input').addEventListener('input', e => {
    document.getElementById('script-char-count').textContent = `${e.target.value.length} 字`;
  });

  // 批量处理
  document.getElementById('batch-run-btn').addEventListener('click', handleBatchGenerate);

  // 初始渲染进度
  renderPipeline({});

  // 加载首页数据
  navigate('generate');
  loadHealth();
});
