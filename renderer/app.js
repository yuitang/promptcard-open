// PromptCard Open - 渲染层逻辑（原创实现）
// 数据全部保存在 localStorage，可随时通过 JSON 导入/导出迁移。
'use strict';

const STORAGE_KEY = 'promptcard_open_data_v1';
const PAGE_SIZE = 12;

// ---------- 状态 ----------
const state = {
  data: null,          // { version, folders, cards, settings }
  filter: { type: 'all', folderId: null, tag: null },
  search: '',
  view: 'grid',
  sort: 'updatedAt',
  page: 1,
  editingCardId: null, // null = 新建
  editorModels: [],
  editorTags: [],
  editorImages: [],    // dataURL 列表
  editorLinks: [],
  currentDetailCardId: null
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

// ---------- 数据层 ----------
function defaultData() {
  return {
    version: 1,
    folders: [
      { id: 'f_ai_chat', name: 'AI 对话' },
      { id: 'f_ai_image', name: 'AI 绘图' }
    ],
    cards: [],
    settings: { view: 'grid', sort: 'updatedAt' }
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state.data = JSON.parse(raw);
      // 兼容缺字段
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
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

  const sorters = {
    updatedAt: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    createdAt: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'zh')
  };
  cards.sort(sorters[state.sort] || sorters.updatedAt);
  return cards;
}

// ---------- 渲染 ----------
function render() {
  renderSidebar();
  renderCards();
  updateStorageStats();
}

function renderSidebar() {
  const cards = state.data.cards;
  $('#countAll').textContent = cards.filter(c => !c.hidden).length;
  $('#countFavorites').textContent = cards.filter(c => c.favorite && !c.hidden).length;
  $('#countHidden').textContent = cards.filter(c => c.hidden).length;

  // 文件夹列表
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

  // 标签云
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

  // 当前视图标题
  let title = '全部卡片';
  if (state.filter.type === 'favorites') title = '收藏';
  else if (state.filter.type === 'hidden') title = '隐藏的卡片';
  else if (state.filter.type === 'folder') title = getFolder(state.filter.folderId)?.name || '分类';
  if (state.filter.tag) title += ` · #${state.filter.tag}`;
  $('#currentViewTitle').textContent = title;

  // 导航高亮
  $$('.nav-section > .nav-item').forEach(el => {
    el.classList.toggle('active',
      el.dataset.filter === state.filter.type && !state.filter.folderId);
  });
}

function cardHTML(c) {
  const folder = getFolder(c.category);
  const imgs = (c.images || []);
  const thumb = imgs.length ? `<img class="card-thumb" src="${imgs[0]}" alt="">` : '';
  const modelChips = (c.models || []).map(m => `<span class="chip">${esc(m)}</span>`).join('');
  const tagChips = (c.tags || []).map(t => `<span class="chip tag">#${esc(t)}</span>`).join('');
  const catChip = folder ? `<span class="chip cat">${esc(folder.name)}</span>` : '';
  return `
    ${thumb}
    <div class="card-body">
      <div class="card-title">
        <span class="fav ${c.favorite ? 'on' : ''}" data-fav="${c.id}" title="收藏">${c.favorite ? '★' : '☆'}</span>
        ${esc(c.title || '未命名卡片')}
        ${c.hidden ? '<span class="chip">🙈已隐藏</span>' : ''}
      </div>
      ${c.description ? `<div class="card-desc">${esc(c.description)}</div>` : ''}
      <div class="card-prompt">${esc(c.prompt || '')}</div>
      <div class="chips">${catChip}${modelChips}${tagChips}</div>
      <div class="card-meta">更新于 ${fmtDate(c.updatedAt)}${c.author ? ' · 作者 ' + esc(c.author) : ''}</div>
    </div>`;
}

function renderCards() {
  const cards = visibleCards();
  const container = $('#cardContainer');
  container.classList.toggle('grid', state.view === 'grid');
  container.classList.toggle('list', state.view === 'list');

  $('#resultCount').textContent = `共 ${cards.length} 张卡片`;
  $('#btnViewToggle').textContent = state.view === 'grid' ? '▤ 列表' : '▦ 网格';

  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const pageCards = cards.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  if (!pageCards.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="big">🗂️</div>
        <div>这里还没有卡片</div>
        <div style="margin-top:8px"><button class="primary-btn" onclick="document.getElementById('btnNewCard').click()">＋ 新建第一张卡片</button></div>
      </div>`;
    renderPagination(totalPages);
    return;
  }

  container.innerHTML = pageCards.map(c =>
    `<div class="card ${state.view === 'list' ? 'list-view' : ''} ${c.hidden ? 'hidden-card' : ''}" data-card="${c.id}">
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

  // 分类下拉
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
    category: $('#cardCategory').value,
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
      favorite: false, hidden: false,
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
    ${(c.images || []).length ? `<div class="detail-images">${c.images.map(s => `<img src="${s}" data-img="${s}">`).join('')}</div>` : ''}`;

  $('#btnHideToggle').textContent = c.hidden ? '取消隐藏' : '隐藏卡片';
  $('#detailModal').hidden = false;
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

  // 按分类分组
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
            favorite: !!c.favorite, hidden: !!c.hidden,
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
  ok.removeEventListener('click', ok._handler || (() => {}));
  ok._handler = handler;
  ok.addEventListener('click', handler);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 侧边栏导航
  $$('.nav-section > .nav-item').forEach(el => {
    el.addEventListener('click', () => {
      state.filter = { type: el.dataset.filter, folderId: null, tag: null };
      state.page = 1;
      render();
    });
  });

  $('#folderList').addEventListener('click', e => {
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
      const name = prompt('重命名分类：', folder.name);
      if (name && name.trim()) {
        folder.name = name.trim();
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

  $('#btnAddFolder').addEventListener('click', () => {
    const name = prompt('新分类名称：');
    if (name && name.trim()) {
      state.data.folders.push({ id: uid(), name: name.trim() });
      saveData(); render();
    }
  });

  // 搜索 / 排序 / 视图
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

  // 卡片点击
  $('#cardContainer').addEventListener('click', e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      e.stopPropagation();
      const c = state.data.cards.find(x => x.id === fav.dataset.fav);
      if (c) { c.favorite = !c.favorite; saveData(); render(); }
      return;
    }
    const card = e.target.closest('[data-card]');
    if (card) openDetail(card.dataset.card);
  });

  // 详情操作
  $('#btnCopyPrompt').addEventListener('click', () => {
    const c = state.data.cards.find(x => x.id === state.currentDetailCardId);
    if (c) {
      navigator.clipboard.writeText(c.prompt || '').then(() => toast('提示词已复制'));
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
      $('#btnHideToggle').textContent = c.hidden ? '取消隐藏' : '隐藏卡片';
      render();
    }
  });
  $('#detailBody').addEventListener('click', e => {
    const a = e.target.closest('a[data-url]');
    if (a) {
      e.preventDefault();
      window.open(a.dataset.url, '_blank');
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
      if (e.target === m && m.id !== 'confirmModal') m.hidden = true;
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = $$('.modal').find(m => !m.hidden && m.id !== 'confirmModal');
      if (open) open.hidden = true;
    }
  });
}

// ---------- 启动 ----------
loadData();
bindEvents();
render();
