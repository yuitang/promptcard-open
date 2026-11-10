// PromptCard Open - 渲染层逻辑（原创实现 v2）
// 数据全部保存在 localStorage，可随时通过 JSON 导入/导出迁移。
'use strict';

const STORAGE_KEY = 'promptcard_open_data_v1';
const PAGE_SIZE = 12;

// ---------- 状态 ----------
const state = {
  data: null,
  filter: { type: 'all', folderId: null, tag: null },
  search: '',
  view: 'grid',
  sort: 'updatedAt',
  page: 1,
  editingCardId: null,
  editorModels: [],
  editorTags: [],
  editorImages: [],
  editorLinks: [],
  currentDetailCardId: null,
  batchMode: false,
  selected: new Set()
};

// ---------- 工具 ----------
function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowISO() { return new Date().toISOString(); }

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

// Electron 兼容：window.prompt 不可用，用自定义对话框替代
function askInput(title, defaultValue) {
  return new Promise(resolve => {
    $('#inputModalTitle').textContent = title;
    const field = $('#inputModalField');
    field.value = defaultValue || '';
    $('#inputModal').hidden = false;
    setTimeout(() => { field.focus(); field.select(); }, 50);

    const okBtn = $('#btnInputOk');
    const cleanup = value => {
      okBtn.removeEventListener('click', onOk);
      field.removeEventListener('keydown', onEnter);
      $('#inputModal').hidden = true;
      resolve(value);
    };
    const onOk = () => cleanup(field.value.trim());
    const onEnter = e => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } };
    okBtn.removeEventListener('click', askInput._prevOk || (() => {}));
    field.removeEventListener('keydown', askInput._prevEnter || (() => {}));
    askInput._prevOk = onOk;
    askInput._prevEnter = onEnter;
    okBtn.addEventListener('click', onOk);
    field.addEventListener('keydown', onEnter);
  });
}

// 外部链接：Electron 用系统浏览器，浏览器环境用 window.open
function openExternal(url) {
  if (window.promptCardAPI && window.promptCardAPI.openExternal) {
    window.promptCardAPI.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

// ---------- 数据层 ----------
function sampleCards() {
  const now = nowISO();
  return [
    {
      title: '电影感人像 · 黄昏逆光', category: 'f_ai_image',
      prompt: '电影感半身人像，年轻女性站在黄昏的天台，夕阳逆光勾出发丝轮廓，浅景深，85mm镜头，胶片颗粒质感，暖橙色调，轻微镜头光晕',
      description: '暖调人像万能公式，换主体可复用', author: '',
      models: ['Midjourney', 'SDXL'], tags: ['人像', '电影感'],
      images: [], links: [{ name: '', url: '' }],
      favorite: true, hidden: false, pinned: true, createdAt: now, updatedAt: now
    },
    {
      title: '产品静物 · 极简白底', category: 'f_ai_image',
      prompt: '极简产品摄影，白色陶瓷马克杯置于纯白背景，柔和顶光加反光板补光，轻微投影，商业级质感，8k细节',
      description: '电商主图风格', author: '',
      models: ['Midjourney'], tags: ['产品图', '电商'],
      images: [], links: [], favorite: false, hidden: false, pinned: false,
      createdAt: now, updatedAt: now
    },
    {
      title: '代码审查助手', category: 'f_ai_chat',
      prompt: '你是一名资深代码审查专家。请审查我提供的代码，按【正确性、可读性、性能、安全性】四个维度输出意见，每个维度给出具体修改建议和示例代码，最后给出总体评分（1-10）。',
      description: '日常代码 Review 模板', author: '',
      models: ['GPT-4o', 'Claude'], tags: ['编程', '效率'],
      images: [], links: [], favorite: false, hidden: false, pinned: false,
      createdAt: now, updatedAt: now
    },
    {
      title: '周报生成器', category: 'f_ai_chat',
      prompt: '根据我列出的本周工作事项，生成一份结构化周报：本周完成 / 进行中 / 下周计划 / 风险与需要的支持。语气专业简洁，每条不超过 30 字。',
      description: '贴上事项就能出周报', author: '',
      models: ['GPT-4o'], tags: ['职场'],
      images: [], links: [], favorite: false, hidden: false, pinned: false,
      createdAt: now, updatedAt: now
    },
    {
      title: '插画 · 吉卜力风格风景', category: 'f_ai_image',
      prompt: '吉卜力风格手绘插画，夏日乡村稻田小路，蓝天白云，远处风车，饱满绿色层次，水彩质感，柔和光线，宫崎骏氛围',
      description: '治愈系风景', author: '',
      models: ['Midjourney', 'NovelAI'], tags: ['插画', '风景'],
      images: [], links: [], favorite: false, hidden: false, pinned: false,
      createdAt: now, updatedAt: now
    }
  ];
}

function defaultData() {
  return {
    version: 1,
    folders: [
      { id: 'f_ai_chat', name: 'AI 对话' },
      { id: 'f_ai_image', name: 'AI 绘图' }
    ],
    cards: sampleCards(),
    settings: { view: 'grid', sort: 'updatedAt' },
    seeded: true
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.data = JSON.parse(raw);
      if (!state.data.folders) state.data.folders = [];
      if (!state.data.cards) state.data.cards = [];
      if (!state.data.settings) state.data.settings = {};
    } else {
      state.data = defaultData();
      saveData();
    }
  } catch (e) {
    console.error('数据读取失败', e);
    state.data = defaultData();
  }
  state.view = state.data.settings.view || 'grid';
  state.sort = state.data.settings.sort || 'updatedAt';
}

function saveData() {
  state.data.settings.view = state.view;
  state.data.settings.sort = state.sort;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  } catch (e) {
    toast('保存失败：本地存储空间不足，请删除部分大图或导出备份');
  }
}

function getFolder(id) {
  return state.data.folders.find(f => f.id === id);
}

// 图片压缩：限制最长边 1200px，JPEG 质量 0.85
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1200;
        let w = img.width, h = img.height;
        if (Math.max(w, h) > maxSide) {
          const ratio = maxSide / Math.max(w, h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- 过滤 / 排序 ----------
function visibleCards() {
  let cards = state.data.cards.slice();
  const f = state.filter;

  if (f.type === 'favorites') cards = cards.filter(c => c.favorite);
  else if (f.type === 'hidden') cards = cards.filter(c => c.hidden);
  else if (f.type === 'folder') cards = cards.filter(c => c.category === f.folderId);
  else cards = cards.filter(c => !c.hidden);

  if (f.tag) cards = cards.filter(c => (c.tags || []).includes(f.tag));

  const q = state.search.trim().toLowerCase();
  if (q) {
    cards = cards.filter(c => {
      const hay = [c.title, c.prompt, c.description, c.author,
        ...(c.models || []), ...(c.tags || []),
        ...(c.links || []).map(l => l.name)]
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  cards.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    const sorters = {
      updatedAt: (x, y) => (y.updatedAt || '').localeCompare(x.updatedAt || ''),
      createdAt: (x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''),
      title: (x, y) => (x.title || '').localeCompare(y.title || '', 'zh')
    };
    return (sorters[state.sort] || sorters.updatedAt)(a, b);
  });
  return cards;
}

// ---------- 渲染 ----------
function render() {
  renderSidebar();
  renderCards();
  renderStats();
  updateStorageStats();
}

function renderSidebar() {
  const cards = state.data.cards;
  $('#countAll').textContent = cards.filter(c => !c.hidden).length;
  $('#countFavorites').textContent = cards.filter(c => c.favorite && !c.hidden).length;
  $('#countHidden').textContent = cards.filter(c => c.hidden).length;

  const folderList = $('#folderList');
  folderList.innerHTML = '';
  state.data.folders.forEach(folder => {
    const count = cards.filter(c => c.category === folder.id && !c.hidden).length;
    const row = document.createElement('div');
    row.className = 'folder-row';
    row.innerHTML = `
      <div class="nav-item ${state.filter.type === 'folder' && state.filter.folderId === folder.id ? 'active' : ''}" data-folder="${folder.id}">
        <span class="nav-icon">📁</span><span>${esc(folder.name)}</span>
        <span class="nav-count">${count}</span>
      </div>
      <div class="folder-actions">
        <button class="icon-btn" data-rename-folder="${folder.id}" title="重命名">✎</button>
        <button class="icon-btn" data-del-folder="${folder.id}" title="删除">🗑</button>
      </div>`;
    folderList.appendChild(row);
  });

  const tagCount = {};
  state.data.cards.forEach(c => (c.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const cloud = $('#tagCloud');
  cloud.innerHTML = '';
  const tags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a]);
  if (!tags.length) {
    cloud.innerHTML = '<span style="font-size:12px;color:var(--text-2)">暂无标签</span>';
  }
  tags.forEach(tag => {
    const pill = document.createElement('span');
    pill.className = 'tag-pill' + (state.filter.tag === tag ? ' active' : '');
    pill.textContent = `${tag} (${tagCount[tag]})`;
    pill.addEventListener('click', () => {
      state.filter.tag = state.filter.tag === tag ? null : tag;
      state.page = 1;
      render();
    });
    cloud.appendChild(pill);
  });

  let title = '全部卡片';
  if (state.filter.type === 'favorites') title = '收藏';
  else if (state.filter.type === 'hidden') title = '隐藏的卡片';
  else if (state.filter.type === 'folder') title = getFolder(state.filter.folderId)?.name || '分类';
  if (state.filter.tag) title += ` · #${state.filter.tag}`;
  $('#currentViewTitle').textContent = title;
}

function renderStats() {
  const cards = state.data.cards;
  const tags = new Set();
  cards.forEach(c => (c.tags || []).forEach(t => tags.add(t)));
  const weekAgo = Date.now() - 7 * 86400000;
  const weekNew = cards.filter(c => new Date(c.createdAt).getTime() > weekAgo).length;
  $('#statCards').textContent = cards.length;
  $('#statFolders').textContent = state.data.folders.length;
  $('#statTags').textContent = tags.size;
  $('#statWeek').textContent = weekNew;
}

function cardHTML(c) {
  const folder = getFolder(c.category);
  const imgs = (c.images || []);
  const thumb = imgs.length
    ? `<img class="card-thumb" src="${imgs[0]}" alt="">`
    : `<div class="card-thumb-placeholder">◈</div>`;
  const modelChips = (c.models || []).map(m => `<span class="chip">${esc(m)}</span>`).join('');
  const tagChips = (c.tags || []).map(t => `<span class="chip tag">#${esc(t)}</span>`).join('');
  const catChip = folder ? `<span class="chip cat">${esc(folder.name)}</span>` : '';
  return `
    <div class="card-check">✓</div>
    <div class="card-thumb-wrap">
      ${thumb}
      ${folder ? `<span class="card-cover-badge">${esc(folder.name)}</span>` : ''}
      <div class="card-flag">
        ${c.pinned ? '<span title="已置顶">📌</span>' : ''}
        ${c.hidden ? '<span title="已隐藏">🙈</span>' : ''}
      </div>
    </div>
    <div class="card-body">
      <div class="card-title">
        <span class="fav ${c.favorite ? 'on' : ''}" data-fav="${c.id}" title="收藏">${c.favorite ? '★' : '☆'}</span>
        <span>${esc(c.title || '未命名卡片')}</span>
      </div>
      ${c.description ? `<div class="card-desc">${esc(c.description)}</div>` : ''}
      <div class="card-prompt">${esc(c.prompt || '')}</div>
      <div class="chips">${catChip}${modelChips}${tagChips}</div>
      <div class="card-footer">
        <span class="card-meta">更新于 ${fmtDate(c.updatedAt)}${c.author ? ' · ' + esc(c.author) : ''}</span>
        <div class="card-actions">
          <button class="icon-btn" data-pin="${c.id}" title="${c.pinned ? '取消置顶' : '置顶'}">📌</button>
          <button class="icon-btn" data-clone="${c.id}" title="克隆">⧉</button>
          <button class="icon-btn" data-edit="${c.id}" title="编辑">✎</button>
          <button class="icon-btn" data-del="${c.id}" title="删除">🗑</button>
        </div>
      </div>
    </div>`;
}

function renderCards() {
  const cards = visibleCards();
  const container = $('#cardContainer');
  container.classList.toggle('grid', state.view === 'grid');
  container.classList.toggle('list', state.view === 'list');
  container.classList.toggle('batch-mode', state.batchMode);

  $('#resultCount').textContent = `共 ${cards.length} 张卡片`;
  $('#btnViewToggle').textContent = state.view === 'grid' ? '▤' : '▦';

  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const pageCards = cards.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  if (!pageCards.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="big">🗂️</div>
        <div>这里还没有卡片</div>
        <div style="margin-top:10px"><button class="primary-btn" onclick="document.getElementById('btnNewCard').click()">＋ 新建第一张卡片</button></div>
      </div>`;
    renderPagination(totalPages);
    return;
  }

  container.innerHTML = pageCards.map(c =>
    `<div class="card ${state.view === 'list' ? 'list-view' : ''} ${c.hidden ? 'hidden-card' : ''} ${state.selected.has(c.id) ? 'selected' : ''}" data-card="${c.id}">
      ${cardHTML(c)}
    </div>`).join('');
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const pg = $('#pagination');
  pg.innerHTML = '';
  if (totalPages <= 1) return;
  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = i === state.page ? 'active' : '';
    btn.addEventListener('click', () => { state.page = i; renderCards(); });
    pg.appendChild(btn);
  }
}

function updateStorageStats() {
  const raw = localStorage.getItem(STORAGE_KEY) || '';
  const kb = (raw.length / 1024).toFixed(1);
  $('#storageStats').innerHTML =
    `卡片总数：${state.data.cards.length}<br>分类：${state.data.folders.length} 个<br>占用空间：${kb} KB`;
}

// ---------- 卡片操作 ----------
function openEditor(cardId) {
  state.editingCardId = cardId || null;
  const c = cardId ? state.data.cards.find(x => x.id === cardId) : null;
  $('#editorTitle').textContent = c ? '编辑卡片' : '新建卡片';
  $('#cardTitle').value = c?.title || '';
  $('#cardPrompt').value = c?.prompt || '';
  $('#cardDescription').value = c?.description || '';
  $('#cardAuthor').value = c?.author || '';

  const sel = $('#cardCategory');
  sel.innerHTML = state.data.folders.map(f =>
    `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  if (c?.category) sel.value = c.category;
  else if (state.filter.type === 'folder') sel.value = state.filter.folderId;

  state.editorModels = [...(c?.models || [])];
  state.editorTags = [...(c?.tags || [])];
  state.editorImages = [...(c?.images || [])];
  state.editorLinks = (c?.links || []).map(l => ({ ...l }));
  if (!state.editorLinks.length) state.editorLinks = [{ name: '', url: '' }];

  renderEditorChips();
  renderEditorLinks();
  renderEditorImages();

  $('#editorModal').hidden = false;
}

function renderEditorChips() {
  const mk = (list, containerId, inputId, removeFn) => {
    const box = $(containerId);
    box.querySelectorAll('.chip').forEach(el => el.remove());
    const input = $(inputId);
    list.slice().reverse().forEach((item, idxRev) => {
      const idx = list.length - 1 - idxRev;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${esc(item)}<button type="button">×</button>`;
      chip.querySelector('button').addEventListener('click', () => removeFn(idx));
      box.insertBefore(chip, input);
    });
  };
  mk(state.editorModels, '#modelChipInput', '#modelInput', i => {
    state.editorModels.splice(i, 1); renderEditorChips();
  });
  mk(state.editorTags, '#tagChipInput', '#tagInput', i => {
    state.editorTags.splice(i, 1); renderEditorChips();
  });
}

function bindChipInput(inputSel, list, rerender) {
  $(inputSel).addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !list.includes(val)) list.push(val);
      e.target.value = '';
      rerender();
    }
  });
}

function renderEditorLinks() {
  const box = $('#linkRows');
  box.innerHTML = '';
  state.editorLinks.forEach((link, i) => {
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `
      <input type="text" placeholder="平台名称" value="${esc(link.name)}">
      <input type="text" placeholder="https://..." value="${esc(link.url)}">
      <button type="button" class="icon-btn" title="移除">×</button>`;
    const [nameIn, urlIn] = row.querySelectorAll('input');
    nameIn.addEventListener('input', () => { link.name = nameIn.value; });
    urlIn.addEventListener('input', () => { link.url = urlIn.value; });
    row.querySelector('.icon-btn').addEventListener('click', () => {
      state.editorLinks.splice(i, 1);
      if (!state.editorLinks.length) state.editorLinks.push({ name: '', url: '' });
      renderEditorLinks();
    });
    box.appendChild(row);
  });
}

function renderEditorImages() {
  const box = $('#imagePreviews');
  box.innerHTML = '';
  state.editorImages.forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview';
    wrap.innerHTML = `<img src="${src}" alt=""><button class="rm" title="移除">×</button>`;
    wrap.querySelector('.rm').addEventListener('click', () => {
      state.editorImages.splice(i, 1);
      renderEditorImages();
    });
    box.appendChild(wrap);
  });
}

async function addImagesFromFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      state.editorImages.push(await compressImage(file));
      renderEditorImages();
    } catch (e) {
      console.error('图片处理失败', e);
    }
  }
}

function saveCardFromForm() {
  const title = $('#cardTitle').value.trim() || '未命名卡片';
  const prompt = $('#cardPrompt').value.trim();
  if (!prompt) { toast('提示词内容不能为空'); return; }

  const payload = {
    title,
    prompt,
    description: $('#cardDescription').value.trim(),
    author: $('#cardAuthor').value.trim(),
    category: $('#cardCategory').value || null,
    models: state.editorModels.slice(),
    tags: state.editorTags.slice(),
    images: state.editorImages.slice(),
    links: state.editorLinks.filter(l => l.name.trim() || l.url.trim())
      .map(l => ({ name: l.name.trim(), url: l.url.trim() }))
  };

  if (state.editingCardId) {
    const c = state.data.cards.find(x => x.id === state.editingCardId);
    if (c) Object.assign(c, payload, { updatedAt: nowISO() });
    toast('卡片已更新');
  } else {
    state.data.cards.push({
      id: uid(), ...payload,
      favorite: false, hidden: false, pinned: false,
      createdAt: nowISO(), updatedAt: nowISO()
    });
    toast('卡片已创建');
  }
  saveData();
  $('#editorModal').hidden = true;
  render();
}

function openDetail(cardId) {
  const c = state.data.cards.find(x => x.id === cardId);
  if (!c) return;
  state.currentDetailCardId = cardId;
  const folder = getFolder(c.category);

  $('#detailTitle').textContent = c.title || '未命名卡片';
  const linkHtml = (c.links || []).length
    ? `<b>平台链接：</b>${c.links.map(l =>
        l.url ? `<a href="#" data-url="${esc(l.url)}">${esc(l.name || l.url)}</a>` : esc(l.name)
      ).join('、')}` : '';

  $('#detailBody').innerHTML = `
    ${c.description ? `<p style="color:var(--text-2);margin-bottom:10px">${esc(c.description)}</p>` : ''}
    <div class="detail-prompt">${esc(c.prompt)}</div>
    <div class="detail-meta">
      ${folder ? `<b>分类：</b>${esc(folder.name)}<br>` : ''}
      ${c.author ? `<b>作者：</b>${esc(c.author)}<br>` : ''}
      ${(c.models || []).length ? `<b>模型：</b>${c.models.map(esc).join('、')}<br>` : ''}
      ${(c.tags || []).length ? `<b>标签：</b>${c.tags.map(t => '#' + esc(t)).join('、')}<br>` : ''}
      ${linkHtml}<br>
      <b>创建：</b>${fmtDate(c.createdAt)}　<b>更新：</b>${fmtDate(c.updatedAt)}
    </div>
    ${(c.images || []).length ? `<div class="detail-images">${c.images.map(s => `<img src="${s}" alt="">`).join('')}</div>` : ''}`;

  $('#btnHideToggle').textContent = c.hidden ? '取消隐藏' : '隐藏';
  $('#detailModal').hidden = false;
}

// ---------- 分享图（canvas 绘制卡片图） ----------
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth) { lines.push(line); line = ch; }
      else line += ch;
    }
    lines.push(line);
  }
  return lines;
}

function generateShareImage(card) {
  const W = 900, PAD = 56;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // 先测量内容高度
  ctx.font = '26px "Microsoft YaHei", sans-serif';
  const title = card.title || '未命名卡片';
  ctx.font = '15px Consolas, monospace';
  const promptLines = wrapText(ctx, card.prompt || '', W - PAD * 2);
  const metaParts = [];
  if ((card.models || []).length) metaParts.push('模型：' + card.models.join('、'));
  if ((card.tags || []).length) metaParts.push('标签：' + card.tags.map(t => '#' + t).join(' '));
  const metaLines = metaParts.length ? wrapText(ctx, metaParts.join('　'), W - PAD * 2) : [];

  const hasImg = (card.images || []).length > 0;
  const IMG_H = hasImg ? 320 : 0;
  const H = PAD + 44 + 20 + promptLines.length * 26 + 24 + metaLines.length * 24 + 40 + IMG_H + 30;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';

  // 背景
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#eef1fd');
  grad.addColorStop(1, '#f7f0fd');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 卡片主体
  const cardY = 24, cardH = H - 48, cardX = 24, cardW = W - 48;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e4e8ef';
  roundRect(ctx, cardX, cardY, cardW, cardH, 18);
  ctx.fill();
  ctx.stroke();

  // 顶部色条
  const barGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
  barGrad.addColorStop(0, '#4f6bed');
  barGrad.addColorStop(1, '#7c5cf0');
  ctx.fillStyle = barGrad;
  roundRectTop(ctx, cardX, cardY, cardW, 8, 18);
  ctx.fill();

  let y = cardY + 46;
  // 标题
  ctx.fillStyle = '#1f2329';
  ctx.font = 'bold 26px "Microsoft YaHei", sans-serif';
  const titleLines = wrapText(ctx, title, cardW - PAD * 1.6);
  titleLines.forEach(tl => { ctx.fillText(tl, cardX + PAD, y); y += 36; });
  y += 8;

  // 配图
  if (hasImg) {
    const img = new Image();
    img.onload = () => drawRest();
    img.onerror = () => drawRest();
    img.src = card.images[0];
    function drawRest() {
      const iw = cardW - PAD * 1.6;
      const ih = IMG_H;
      ctx.save();
      roundRect(ctx, cardX + PAD, y, iw, ih, 12);
      ctx.clip();
      ctx.drawImage(img, cardX + PAD, y, iw, ih);
      ctx.restore();
      y += ih + 24;
      finish();
    }
  } else {
    finish();
  }

  function finish() {
    // 提示词
    ctx.font = '15px Consolas, monospace';
    ctx.fillStyle = '#3d4450';
    promptLines.forEach(tl => { ctx.fillText(tl, cardX + PAD, y); y += 26; });
    y += 16;

    // 元信息
    if (metaLines.length) {
      ctx.font = '14px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#6b7280';
      metaLines.forEach(ml => { ctx.fillText(ml, cardX + PAD, y); y += 24; });
    }

    // 底部署名
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#9aa2b1';
    ctx.fillText('PromptCard Open · ' + fmtDate(card.updatedAt), cardX + PAD, cardY + cardH - 26);

    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    out.getContext('2d').drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `${(card.title || '卡片').slice(0, 20)}-分享图.png`;
    a.click();
    toast('分享图已生成并下载');
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundRectTop(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- 导出 ----------
function buildCardMD(c, folderName) {
  const lines = [];
  lines.push(`## ${c.title || '未命名卡片'}`);
  if (c.description) lines.push(`> ${c.description}`);
  const meta = [];
  if (folderName) meta.push(`分类：${folderName}`);
  if (c.author) meta.push(`作者：${c.author}`);
  if ((c.models || []).length) meta.push(`模型：${c.models.join('、')}`);
  if ((c.tags || []).length) meta.push(`标签：${c.tags.map(t => '#' + t).join(' ')}`);
  if ((c.links || []).length) meta.push(`链接：${c.links.map(l => `${l.name || ''}${l.url ? '(' + l.url + ')' : ''}`).join('、')}`);
  if (meta.length) lines.push('', meta.join(' ｜ '));
  lines.push('', '```text', c.prompt || '', '```', '');
  return lines.join('\n');
}

function buildCardTXT(c, folderName) {
  const lines = [];
  lines.push('='.repeat(50));
  lines.push(`【${c.title || '未命名卡片'}】`);
  if (folderName) lines.push(`分类：${folderName}`);
  if (c.author) lines.push(`作者：${c.author}`);
  if ((c.models || []).length) lines.push(`模型：${c.models.join('、')}`);
  if ((c.tags || []).length) lines.push(`标签：${c.tags.join('、')}`);
  if ((c.links || []).length) lines.push(`链接：${c.links.map(l => `${l.name || ''}${l.url ? '(' + l.url + ')' : ''}`).join('、')}`);
  lines.push('-'.repeat(50));
  lines.push(c.prompt || '');
  lines.push('');
  return lines.join('\n');
}

function doExport(format, scope) {
  let cards;
  if (scope === 'current' && state.filter.type === 'folder') {
    cards = state.data.cards.filter(c => c.category === state.filter.folderId);
  } else if (scope === 'current') {
    cards = visibleCards();
  } else {
    cards = state.data.cards;
  }
  if (!cards.length) { toast('没有可导出的卡片'); return; }

  const ts = fmtDate(nowISO()).replace(/[- :]/g, '').slice(0, 12);

  if (format === 'json') {
    const payload = {
      exportedFrom: 'PromptCard Open',
      version: 1,
      exportedAt: nowISO(),
      folders: state.data.folders,
      cards
    };
    downloadFile(`promptcard-open-backup-${ts}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`已导出 ${cards.length} 张卡片（JSON）`);
    return;
  }

  const groups = {};
  cards.forEach(c => {
    const name = getFolder(c.category)?.name || '未分类';
    (groups[name] = groups[name] || []).push(c);
  });

  const parts = [];
  if (format === 'md') {
    parts.push(`# PromptCard Open 导出\n\n> 导出时间：${fmtDate(nowISO())} ｜ 卡片数：${cards.length}\n`);
    for (const [folderName, list] of Object.entries(groups)) {
      parts.push(`\n# ${folderName}\n`);
      list.forEach(c => parts.push(buildCardMD(c, folderName)));
    }
  } else {
    for (const [folderName, list] of Object.entries(groups)) {
      parts.push(`\n\n########## 分类：${folderName}（${list.length} 张）##########\n\n`);
      list.forEach(c => parts.push(buildCardTXT(c, folderName)));
    }
  }
  const ext = format === 'md' ? 'md' : 'txt';
  downloadFile(`promptcard-open-${ts}.${ext}`, parts.join('\n'), 'text/plain;charset=utf-8');
  toast(`已导出 ${cards.length} 张卡片（${ext.toUpperCase()}）`);
}

function doImport(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const payload = JSON.parse(e.target.result);
      const cards = Array.isArray(payload) ? payload : payload.cards;
      const folders = Array.isArray(payload) ? [] : (payload.folders || []);
      if (!Array.isArray(cards)) throw new Error('缺少 cards 字段');

      let addedFolders = 0, addedCards = 0, mergedCards = 0;
      folders.forEach(f => {
        if (f.id && f.name && !getFolder(f.id)) {
          state.data.folders.push({ id: f.id, name: f.name });
          addedFolders++;
        }
      });
      cards.forEach(c => {
        if (!c || typeof c !== 'object') return;
        const existing = c.id && state.data.cards.find(x => x.id === c.id);
        if (existing) {
          Object.assign(existing, c, { updatedAt: nowISO() });
          mergedCards++;
        } else {
          state.data.cards.push({
            id: c.id || uid(),
            title: c.title || '未命名卡片',
            prompt: c.prompt || '',
            description: c.description || '',
            author: c.author || '',
            category: getFolder(c.category) ? c.category : (state.data.folders[0]?.id || null),
            models: c.models || [], tags: c.tags || [],
            images: c.images || [], links: c.links || [],
            favorite: !!c.favorite, hidden: !!c.hidden, pinned: !!c.pinned,
            createdAt: c.createdAt || nowISO(), updatedAt: c.updatedAt || nowISO()
          });
          addedCards++;
        }
      });
      saveData();
      render();
      toast(`导入完成：新增 ${addedCards} 张、合并更新 ${mergedCards} 张${addedFolders ? `、新增分类 ${addedFolders} 个` : ''}`);
    } catch (err) {
      toast('导入失败：' + err.message);
    }
  };
  reader.readAsText(file);
}

// ---------- 确认框 ----------
function confirmAction(title, text, fn) {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmModal').hidden = false;
  const ok = $('#btnConfirmOk');
  const handler = () => {
    ok.removeEventListener('click', handler);
    $('#confirmModal').hidden = true;
    fn();
  };
  ok.removeEventListener('click', confirmAction._prev || (() => {}));
  confirmAction._prev = handler;
  ok.addEventListener('click', handler);
}

// ---------- 批量模式 ----------
function toggleBatchMode() {
  state.batchMode = !state.batchMode;
  state.selected.clear();
  $('#batchBar').hidden = !state.batchMode;
  if (state.batchMode) {
    const sel = $('#batchMoveSelect');
    sel.innerHTML = state.data.folders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  }
  $('#btnBatch').classList.toggle('active-btn', state.batchMode);
  renderCards();
}

function updateBatchCount() {
  $('#batchCount').textContent = state.selected.size;
}

// ---------- 事件绑定 ----------
function bindEvents() {
  $$('.nav-section > .nav-item').forEach(el => {
    el.addEventListener('click', () => {
      state.filter = { type: el.dataset.filter, folderId: null, tag: null };
      state.page = 1;
      render();
    });
  });

  $('#folderList').addEventListener('click', async e => {
    const nav = e.target.closest('[data-folder]');
    if (nav) {
      state.filter = { type: 'folder', folderId: nav.dataset.folder, tag: null };
      state.page = 1;
      render();
      return;
    }
    const ren = e.target.closest('[data-rename-folder]');
    if (ren) {
      const folder = getFolder(ren.dataset.renameFolder);
      const name = await askInput('重命名分类', folder.name);
      if (name) {
        folder.name = name;
        saveData(); render();
      }
      return;
    }
    const del = e.target.closest('[data-del-folder]');
    if (del) {
      const folder = getFolder(del.dataset.delFolder);
      const count = state.data.cards.filter(c => c.category === folder.id).length;
      confirmAction('删除分类',
        `确定删除分类「${folder.name}」吗？其中 ${count} 张卡片将变为未分类，不会被删除。`, () => {
          state.data.folders = state.data.folders.filter(f => f.id !== folder.id);
          state.data.cards.forEach(c => { if (c.category === folder.id) c.category = null; });
          if (state.filter.folderId === folder.id) state.filter = { type: 'all', folderId: null, tag: null };
          saveData(); render();
        });
    }
  });

  $('#btnAddFolder').addEventListener('click', async () => {
    const name = await askInput('新分类名称', '');
    if (name) {
      state.data.folders.push({ id: uid(), name });
      saveData(); render();
    }
  });

  $('#searchInput').addEventListener('input', e => {
    state.search = e.target.value;
    state.page = 1;
    renderCards();
  });
  $('#sortSelect').addEventListener('change', e => {
    state.sort = e.target.value;
    saveData(); renderCards();
  });
  $('#btnViewToggle').addEventListener('click', () => {
    state.view = state.view === 'grid' ? 'list' : 'grid';
    saveData(); renderCards();
  });
  $('#btnBatch').addEventListener('click', toggleBatchMode);

  $('#cardContainer').addEventListener('click', e => {
    if (state.batchMode) {
      const card = e.target.closest('[data-card]');
      if (card) {
        const id = card.dataset.card;
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        updateBatchCount();
        renderCards();
      }
      return;
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      const c = state.data.cards.find(x => x.id === fav.dataset.fav);
      if (c) { c.favorite = !c.favorite; saveData(); render(); }
      return;
    }
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      e.stopPropagation();
      const c = state.data.cards.find(x => x.id === pin.dataset.pin);
      if (c) { c.pinned = !c.pinned; saveData(); render(); toast(c.pinned ? '已置顶' : '已取消置顶'); }
      return;
    }
    const clone = e.target.closest('[data-clone]');
    if (clone) {
      e.stopPropagation();
      const c = state.data.cards.find(x => x.id === clone.dataset.clone);
      if (c) {
        state.data.cards.push({
          ...JSON.parse(JSON.stringify(c)),
          id: uid(), title: (c.title || '卡片') + ' 副本',
          createdAt: nowISO(), updatedAt: nowISO()
        });
        saveData(); render(); toast('已克隆卡片');
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      e.stopPropagation();
      openDetail(edit.dataset.edit);
      $('#detailModal').hidden = true;
      openEditor(edit.dataset.edit);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      confirmAction('删除卡片', '确定删除这张卡片吗？此操作不可撤销（建议先导出 JSON 备份）。', () => {
        state.data.cards = state.data.cards.filter(x => x.id !== del.dataset.del);
        saveData(); render(); toast('卡片已删除');
      });
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) openDetail(card.dataset.card);
  });

  // 批量操作
  $('#btnBatchMove').addEventListener('click', () => {
    if (!state.selected.size) { toast('请先选择卡片'); return; }
    const target = $('#batchMoveSelect').value;
    state.data.cards.forEach(c => { if (state.selected.has(c.id)) c.category = target; });
    saveData(); render();
    toast(`已移动 ${state.selected.size} 张卡片`);
    toggleBatchMode();
  });
  $('#btnBatchExport').addEventListener('click', () => {
    if (!state.selected.size) { toast('请先选择卡片'); return; }
    const cards = state.data.cards.filter(c => state.selected.has(c.id));
    const payload = {
      exportedFrom: 'PromptCard Open', version: 1, exportedAt: nowISO(),
      folders: state.data.folders, cards
    };
    downloadFile(`promptcard-open-selected-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`已导出 ${cards.length} 张卡片`);
  });
  $('#btnBatchDelete').addEventListener('click', () => {
    if (!state.selected.size) { toast('请先选择卡片'); return; }
    const n = state.selected.size;
    confirmAction('批量删除', `确定删除选中的 ${n} 张卡片吗？此操作不可撤销。`, () => {
      state.data.cards = state.data.cards.filter(c => !state.selected.has(c.id));
      saveData(); toggleBatchMode(); render();
      toast(`已删除 ${n} 张卡片`);
    });
  });
  $('#btnBatchExit').addEventListener('click', toggleBatchMode);

  // 详情操作
  $('#btnCopyPrompt').addEventListener('click', () => {
    const c = state.data.cards.find(x => x.id === state.currentDetailCardId);
    if (c) {
      navigator.clipboard.writeText(c.prompt || '').then(() => toast('提示词已复制'));
    }
  });
  $('#btnShareImage').addEventListener('click', () => {
    const c = state.data.cards.find(x => x.id === state.currentDetailCardId);
    if (c) { $('#detailModal').hidden = true; generateShareImage(c); }
  });
  $('#btnCloneCard').addEventListener('click', () => {
    const c = state.data.cards.find(x => x.id === state.currentDetailCardId);
    if (c) {
      state.data.cards.push({
        ...JSON.parse(JSON.stringify(c)),
        id: uid(), title: (c.title || '卡片') + ' 副本',
        createdAt: nowISO(), updatedAt: nowISO()
      });
      saveData();
      $('#detailModal').hidden = true;
      render(); toast('已克隆卡片');
    }
  });
  $('#btnEditFromDetail').addEventListener('click', () => {
    $('#detailModal').hidden = true;
    openEditor(state.currentDetailCardId);
  });
  $('#btnDeleteCard').addEventListener('click', () => {
    confirmAction('删除卡片', '确定删除这张卡片吗？此操作不可撤销（建议先导出 JSON 备份）。', () => {
      state.data.cards = state.data.cards.filter(x => x.id !== state.currentDetailCardId);
      saveData();
      $('#detailModal').hidden = true;
      render();
      toast('卡片已删除');
    });
  });
  $('#btnHideToggle').addEventListener('click', () => {
    const c = state.data.cards.find(x => x.id === state.currentDetailCardId);
    if (c) {
      c.hidden = !c.hidden;
      saveData();
      $('#btnHideToggle').textContent = c.hidden ? '取消隐藏' : '隐藏';
      render();
    }
  });
  $('#detailBody').addEventListener('click', e => {
    const a = e.target.closest('a[data-url]');
    if (a) {
      e.preventDefault();
      openExternal(a.dataset.url);
    }
  });

  // 新建 / 编辑
  $('#btnNewCard').addEventListener('click', () => openEditor(null));
  $('#btnSaveCard').addEventListener('click', saveCardFromForm);
  bindChipInput('#modelInput', state.editorModels, renderEditorChips);
  bindChipInput('#tagInput', state.editorTags, renderEditorChips);

  $('#btnAddLink').addEventListener('click', () => {
    state.editorLinks.push({ name: '', url: '' });
    renderEditorLinks();
  });

  // 图片上传
  $('#imageDrop').addEventListener('click', () => $('#imageInput').click());
  $('#imageInput').addEventListener('change', e => {
    addImagesFromFiles(Array.from(e.target.files));
    e.target.value = '';
  });
  const drop = $('#imageDrop');
  ['dragover', 'dragleave', 'drop'].forEach(ev => {
    drop.addEventListener(ev, e => {
      e.preventDefault();
      drop.classList.toggle('dragover', ev === 'dragover');
      if (ev === 'drop') addImagesFromFiles(Array.from(e.dataTransfer.files));
    });
  });

  // 导出 / 导入
  $('#btnExport').addEventListener('click', () => { $('#exportModal').hidden = false; });
  $('#btnDoExport').addEventListener('click', () => {
    doExport($('#exportFormat').value, $('#exportScope').value);
    $('#exportModal').hidden = true;
  });
  $('#btnImport').addEventListener('click', () => $('#importFileInput').click());
  $('#importFileInput').addEventListener('change', e => {
    if (e.target.files[0]) doImport(e.target.files[0]);
    e.target.value = '';
  });

  // 模态框关闭
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) {
      $('#' + e.target.closest('[data-close]').dataset.close).hidden = true;
    }
  });
  $$('.modal').forEach(m => {
    m.addEventListener('mousedown', e => {
      if (e.target === m && m.id !== 'confirmModal' && m.id !== 'inputModal') m.hidden = true;
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = $$('.modal').find(m => !m.hidden && m.id !== 'confirmModal' && m.id !== 'inputModal');
      if (open) open.hidden = true;
    }
  });
}

// ---------- 启动 ----------
loadData();
$('#sortSelect').value = state.sort;
bindEvents();
render();
