import { isEagleImportable } from '../shared/eagle.js';

export function primaryButton(status = {}) {
  if (status.phase === 'scanning' || status.collecting) return { label: '停止扫描', disabled: false, action: 'STOP_SCAN' };
  if (status.phase === 'downloading' || status.downloading > 0) return { label: '正在下载…', disabled: true, action: null };
  return { label: status.total > 0 ? '开始新任务' : '开始扫描', disabled: false, action: 'START' };
}

export function autoScrollButton(status = {}) {
  if (status.phase !== 'scanning' || status.scrollMode !== 'auto') return null;
  return status.autoScrollPaused ? { label: '继续自动滚动', action: 'RESUME_AUTO_SCROLL' } : { label: '暂停自动滚动', action: 'PAUSE_AUTO_SCROLL' };
}

export function taskStateView(status = {}) {
  const phase = status.phase ?? 'idle';
  const state = phase === 'scanning' || status.collecting ? { label: '扫描中', tone: 'scanning' }
    : phase === 'downloading' || status.downloading > 0 ? { label: '下载中', tone: 'downloading' }
      : phase === 'complete' ? { label: '已完成', tone: 'complete' }
        : { label: '待开始', tone: 'idle' };
  return { ...state, total: status.total ?? 0, pending: status.pending ?? 0, completed: status.completed ?? 0, unavailable: status.unavailable ?? 0 };
}

export function mediaTabs(items = []) {
  return { downloadable: items.filter((item) => item.status !== 'unavailable'), unavailable: items.filter((item) => item.status === 'unavailable') };
}

export function filterMediaItems(items = [], type = 'all') {
  if (type === 'image') return items.filter((item) => item.kind === 'image');
  if (type === 'video') return items.filter((item) => item.kind === 'video' || item.kind === 'hls');
  return items;
}

function stableItemKey(item) {
  return `${item?.tweetId ?? ''}:${item?.mediaIndex ?? -1}`;
}

export function downloadTargets(items = [], key = null) {
  return items.filter((item) => item.url && (key ? stableItemKey(item) === key && item.status !== 'downloading' : item.status === 'pending'));
}

export function eagleTargets(items = [], key = null, skipSaved = true) {
  return items.filter((item) => isEagleImportable(item, !skipSaved) && (!key || stableItemKey(item) === key));
}

export function eagleImportSummary(items = [], skipSaved = true) {
  return { importable: eagleTargets(items, null, skipSaved).length, imported: items.filter((item) => item.eagleStatus === 'imported').length, hls: items.filter((item) => item.kind === 'hls').length };
}

export function outputFilename(item) {
  return item.kind === 'hls' ? item.filename.replace(/\.m3u8(?:$|\?)/i, '.mp4') : item.filename;
}

export async function writeMediaFile(directory, item, fetchImpl = fetch) {
  const response = await fetchImpl(item.url, { credentials: 'include' });
  if (!response.ok) throw new Error(`下载请求失败（HTTP ${response.status}）`);
  const userDirectory = await directory.getDirectoryHandle(item.username, { create: true });
  const file = await userDirectory.getFileHandle(item.filename.split('/').at(-1), { create: true });
  const writable = await file.createWritable();
  await writable.write(await response.blob());
  await writable.close();
}

export async function writeHlsFile(directory, item, onProgress = () => {}, { workerFactory = () => new Worker('hls-worker.js'), timeoutMs = 45_000 } = {}) {
  const worker = workerFactory();
  const requestId = crypto.randomUUID();
  const result = await new Promise((resolve, reject) => {
    let timeoutId;
    const fail = (error) => {
      clearTimeout(timeoutId);
      reject(error);
    };
    const armTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fail(new Error(`HLS 下载超时：${Math.round(timeoutMs / 1000)} 秒内没有收到视频处理进度`)), timeoutMs);
    };
    worker.onmessage = ({ data }) => {
      if (data.requestId !== requestId) return;
      if (data.type === 'HLS_PROGRESS') { armTimeout(); onProgress(data.completed, data.total); }
      if (data.type === 'HLS_COMPLETE') { clearTimeout(timeoutId); resolve(data.chunks); }
      if (data.type === 'HLS_ERROR') fail(new Error(data.error));
    };
    worker.onerror = (event) => fail(new Error(`HLS 转换 Worker 异常：${event.message || '未知错误'}`));
    worker.onmessageerror = () => fail(new Error('HLS 转换 Worker 返回的数据无法读取'));
    armTimeout();
    worker.postMessage({ type: 'DOWNLOAD_HLS', requestId, url: item.url });
  }).finally(() => worker.terminate());
  const userDirectory = await directory.getDirectoryHandle(item.username, { create: true });
  const file = await userDirectory.getFileHandle(outputFilename(item).split('/').at(-1), { create: true });
  const writable = await file.createWritable();
  await writable.write(new Blob(result, { type: 'video/mp4' }));
  await writable.close();
}


export async function downloadSelected(directory, items, sendMessage = (message) => chrome.runtime.sendMessage(message), fetchImpl = fetch) {
  if (!items.length) return;
  await sendMessage({ type: 'BEGIN_DIRECTORY_DOWNLOAD' });
  for (const item of items) {
    await sendMessage({ type: 'DOWNLOAD_ITEM_STATUS', key: item.key, status: 'downloading', log: `正在下载：${item.filename ?? item.key}` });
    try {
      if (item.kind === 'hls') await writeHlsFile(directory, item, (completed, total) => sendMessage({ type: 'DOWNLOAD_ITEM_STATUS', key: item.key, status: 'downloading', log: `正在合并 MP4：${completed}/${total}` }));
      else await writeMediaFile(directory, item, fetchImpl);
      await sendMessage({ type: 'DOWNLOAD_ITEM_STATUS', key: item.key, status: 'completed', log: `下载完成：${item.filename ?? item.key}` });
    } catch (error) {
      await sendMessage({ type: 'DOWNLOAD_ITEM_STATUS', key: item.key, status: 'failed', error: error.message, log: `下载失败：${error.message}` });
    }
  }
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const safeUrl = (value) => /^https?:\/\//i.test(value ?? '') ? value : '';

export function renderMediaList(items = [], tab = 'downloadable', skipSaved = true) {
  if (!items.length) return '<p class="empty">没有媒体项。</p>';
  return items.map((item) => {
    const url = safeUrl(item.url);
    const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString('zh-CN') : '日期未知';
    const status = item.status === 'unavailable' ? item.error ?? '没有可下载的 MP4 版本' : ({ pending: '待下载', downloading: '下载中', completed: '已完成', failed: `失败：${item.error ?? '未知错误'}` }[item.status] ?? item.status);
    const type = item.kind === 'hls' ? 'HLS 视频' : item.kind === 'video' ? '视频' : '图片';
    const link = url ? `<a class="link-action" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">原始链接</a>` : '';
    const stableKey = escapeHtml(stableItemKey(item));
    const download = tab === 'downloadable' && url ? `<button type="button" data-download-key="${stableKey}" ${item.status === 'downloading' ? 'disabled' : ''}>${item.status === 'completed' ? '重新下载' : '下载'}</button>` : '';
    const eagle = tab === 'downloadable' && item.eagleStatus === 'imported' && skipSaved ? '<button type="button" disabled>已保存 Eagle</button>' : tab === 'downloadable' && isEagleImportable(item, !skipSaved) ? `<button type="button" data-eagle-key="${stableKey}">${item.eagleStatus === 'imported' ? '重新保存 Eagle' : '保存 Eagle'}</button>` : '';
    return `<article class="media-item"><div class="media-head"><strong>${type}</strong><span>${escapeHtml(date)}</span></div><div class="media-actions"><small class="status-chip">${escapeHtml(status)}</small>${link}<span class="media-download">${eagle}${download}</span></div></article>`;
  }).join('');
}

function summaryText(status) {
  if (status?.error) return `错误：${status.error}`;
  if (status?.phase === 'scanning' || status?.collecting) return `正在${status.scrollMode === 'auto' ? '自动' : '手动'}扫描。已发现 ${status.total ?? 0} 个媒体。${status.autoScrollPaused ? ' 自动滚动已暂停。' : ''}`;
  return `已采集 ${status?.total ?? 0} 项；待下载 ${status?.pending ?? 0}，下载中 ${status?.downloading ?? 0}，完成 ${status?.completed ?? 0}，失败 ${status?.failed ?? 0}，无可用 MP4 ${status?.unavailable ?? 0}。`;
}

async function currentProfile() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url ?? '');
  if (!['x.com', 'twitter.com'].includes(url.hostname)) return null;
  const username = url.pathname.split('/').filter(Boolean)[0];
  if (!username || ['home', 'explore', 'search', 'settings', 'i'].includes(username)) return null;
  const identity = await chrome.runtime.sendMessage({ type: 'GET_X_PROFILE_IDENTITY', tabId: tab.id });
  if (identity?.error) throw new Error(identity.error);
  return { username, profileName: identity?.profileName ?? '' };
}

function mount() {
  const primary = document.querySelector('#primary'); const autoScroll = document.querySelector('#auto-scroll'); const retry = document.querySelector('#retry'); const batch = document.querySelector('#batch-download'); const eagleBatch = document.querySelector('#eagle-batch'); const eagleStatus = document.querySelector('#eagle-status'); const eagleTarget = document.querySelector('#eagle-target'); const eagleRefresh = document.querySelector('#eagle-refresh'); const importReport = document.querySelector('#import-report'); const mediaPrev = document.querySelector('#media-prev'); const mediaNext = document.querySelector('#media-next'); const mediaPage = document.querySelector('#media-page');
  const statusNode = document.querySelector('#status'); const logsNode = document.querySelector('#logs'); const listNode = document.querySelector('#media-list'); const downloadableTab = document.querySelector('#tab-downloadable'); const unavailableTab = document.querySelector('#tab-unavailable'); const mediaFilters = [...document.querySelectorAll('[data-media-filter]')]; const stateNode = document.querySelector('#task-state'); const totalNode = document.querySelector('#stat-total'); const pendingNode = document.querySelector('#stat-pending'); const completedNode = document.querySelector('#stat-completed'); const unavailableNode = document.querySelector('#stat-unavailable');
  let status = {}; let items = []; let page = { total: 0, offset: 0, limit: 80, counts: {} }; let activeTab = 'downloadable'; let activeMediaFilter = 'all'; let eagle = { available: false, folders: [], error: '正在检测 Eagle…' }; let eagleProgress = null; let eagleProgressCheckedAt = 0; let refreshing = false;
  const render = () => {
    const state = taskStateView(status); stateNode.textContent = state.label; stateNode.dataset.tone = state.tone; totalNode.textContent = state.total; pendingNode.textContent = state.pending; completedNode.textContent = state.completed; unavailableNode.textContent = state.unavailable;
    const next = primaryButton(status); primary.textContent = next.label; primary.disabled = next.disabled; primary.dataset.action = next.action ?? '';
    const autoAction = autoScrollButton(status); autoScroll.hidden = !autoAction; autoScroll.textContent = autoAction?.label ?? ''; autoScroll.dataset.action = autoAction?.action ?? '';
    const counts = page.counts ?? {}; downloadableTab.textContent = `可下载 (${counts.downloadable ?? 0})`; unavailableTab.textContent = `不可下载 (${counts.unavailable ?? 0})`;
    downloadableTab.classList.toggle('active', activeTab === 'downloadable'); unavailableTab.classList.toggle('active', activeTab === 'unavailable');
    mediaFilters.forEach((button) => { const selected = button.dataset.mediaFilter === activeMediaFilter; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
    listNode.innerHTML = renderMediaList(items, activeTab, false);
    const last = Math.min(page.offset + items.length, page.total);
    mediaPage.textContent = page.total ? `${page.offset + 1}–${last} / ${page.total}` : '暂无媒体项'; mediaPrev.disabled = page.offset <= 0; mediaNext.disabled = last >= page.total;
    batch.hidden = status.phase === 'scanning' || !(status.pending > 0); batch.disabled = status.downloading > 0; retry.hidden = !(status.failed > 0);
    const eagleSummary = { importable: counts.eagleImportable ?? 0, imported: counts.eagleImported ?? 0, hls: counts.hls ?? 0 };
    eagleBatch.disabled = !eagle.available || !eagleSummary.importable;
    eagleBatch.textContent = `保存 ${eagleSummary.importable} 个到 Eagle`;
    const importProgress = eagleProgress ?? status.eagleImport;
    eagleStatus.textContent = eagle.available
      ? importProgress?.phase === 'browser_downloading'
        ? `正在通过 Chrome 下载图片：${importProgress.downloaded ?? 0}/${importProgress.total ?? 0}，失败 ${importProgress.failed ?? 0}；完成后将立即交给 Eagle。`
        : importProgress?.submitted
        ? `本批已提交 ${importProgress.submitted} 项；Eagle 已入库 ${importProgress.added ?? 0} 项，${importProgress.unresolved ?? importProgress.submitted} 项仍在处理或被判重。`
        : `Eagle 已连接；待导入 ${eagleSummary.importable} 个（含 HLS ${eagleSummary.hls} 个），已提交 ${eagleSummary.imported} 个`
      : eagle.error ?? '未检测到 Eagle';
    importReport.textContent = importProgress?.phase === 'browser_downloading'
      ? `扫描唯一 ${status.total ?? 0} 项；同源合并 ${status.merged ?? 0} 项；浏览器已下载 ${importProgress.downloaded ?? 0}/${importProgress.total ?? 0} 项；下载失败 ${importProgress.failed ?? 0} 项。`
      : importProgress?.submitted
      ? `扫描唯一 ${status.total ?? 0} 项；同源合并 ${status.merged ?? 0} 项；严格内容去重 ${importProgress.deduplicated ?? 0} 项；提交 Eagle ${importProgress.submitted} 项；实际入库 ${importProgress.added ?? 0} 项；下载失败 ${importProgress.failed ?? 0} 项。`
      : `扫描唯一 ${status.total ?? 0} 项；同源合并 ${status.merged ?? 0} 项；下载失败 ${status.failed ?? 0} 项。`;
    eagleTarget.textContent = status.username ? `将自动保存到 @${String(status.username).replace(/^@+/, '')}` : '开始扫描后将自动创建推主文件夹';
    statusNode.textContent = summaryText(status); logsNode.textContent = (status.logs ?? []).join('\n') || '等待采集日志…'; logsNode.scrollTop = logsNode.scrollHeight;
  };
  const refreshEagleProgress = async (force = false) => {
    if (!status.eagleImport?.folderId || (!force && Date.now() - eagleProgressCheckedAt < 7_000)) return;
    eagleProgressCheckedAt = Date.now();
    const next = await chrome.runtime.sendMessage({ type: 'GET_EAGLE_IMPORT_PROGRESS' });
    if (!next?.error) eagleProgress = next;
    render();
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      if (!status.eagleImport) eagleProgress = null;
      page = await chrome.runtime.sendMessage({ type: 'GET_TASK_ITEMS', tab: activeTab, mediaType: activeMediaFilter, offset: page.offset, limit: page.limit });
      items = page.items ?? [];
      render();
      refreshEagleProgress().catch(() => {});
    } finally { refreshing = false; }
  };
  const allItems = async () => (await chrome.runtime.sendMessage({ type: 'GET_TASK_ITEMS', all: true })).items ?? [];
  const refreshEagle = async () => { eagle = await chrome.runtime.sendMessage({ type: 'GET_EAGLE_FOLDERS' }); render(); };
  const importToEagle = async (targets) => {
    if (!eagle.available) return;
    if (!targets.length) { eagleStatus.textContent = '未找到可保存的媒体项'; return; }
    eagleBatch.disabled = true;
    eagleStatus.textContent = '正在保存到 Eagle…';
    let profile;
    try { profile = await currentProfile(); }
    catch (error) { eagleStatus.textContent = `无法保存：${error.message}`; eagleBatch.disabled = false; return; }
    if (!profile) { eagleStatus.textContent = '无法保存：请先打开当前采集的 X 用户主页。'; eagleBatch.disabled = false; return; }
    const result = await chrome.runtime.sendMessage({ type: 'IMPORT_EAGLE_ITEMS', keys: targets.map((item) => item.key), profileName: profile.profileName, allowReimport: true });
    eagleStatus.textContent = result?.error ?? `已提交 ${result?.submitted ?? 0} 项到 ${result?.folder?.name ?? 'Eagle'}${result?.failed ? `，提交失败 ${result.failed} 项` : ''}`;
    eagleProgress = null;
    await refresh();
    await refreshEagleProgress(true);
  };
  const chooseAndDownload = async (targets) => {
    if (!targets.length) return;
    if (typeof window.showDirectoryPicker !== 'function') { status = { ...status, error: '当前 Chrome 不支持选择目录；请升级 Chrome 后重试。' }; render(); return; }
    try { await downloadSelected(await window.showDirectoryPicker({ mode: 'readwrite' }), targets); await refresh(); }
    catch (error) { status = { ...status, error: error.name === 'AbortError' ? '已取消选择文件夹，尚未开始下载。' : `无法选择文件夹：${error.message}` }; render(); }
  };
  primary.addEventListener('click', async () => {
    if (primary.dataset.action === 'STOP_SCAN') status = await chrome.runtime.sendMessage({ type: 'STOP_COLLECTION' });
    else if (primary.dataset.action === 'START') { let profile; try { profile = await currentProfile(); } catch (error) { status = { error: error.message }; render(); return; } if (!profile) { status = { error: '请先打开 X 用户主页。' }; render(); return; } status = await chrome.runtime.sendMessage({ type: 'START_COLLECTION', username: profile.username, profileName: profile.profileName, scrollMode: document.querySelector('input[name="scroll-mode"]:checked')?.value ?? 'manual', options: { includeReplies: document.querySelector('#replies').checked, includeReposts: document.querySelector('#reposts').checked, mediaType: document.querySelector('input[name="media-type"]:checked')?.value ?? 'all' } }); }
    await refresh();
  });
  batch.addEventListener('click', async () => chooseAndDownload(downloadTargets(await allItems())));
  eagleBatch.addEventListener('click', async () => importToEagle(eagleTargets(await allItems(), null, false)));
  eagleRefresh.addEventListener('click', refreshEagle);
  autoScroll.addEventListener('click', async () => { status = await chrome.runtime.sendMessage({ type: autoScroll.dataset.action }); render(); });
  retry.addEventListener('click', async () => { status = await chrome.runtime.sendMessage({ type: 'PREPARE_RETRY_FAILED' }); await refresh(); });
  downloadableTab.addEventListener('click', async () => { activeTab = 'downloadable'; page.offset = 0; await refresh(); }); unavailableTab.addEventListener('click', async () => { activeTab = 'unavailable'; page.offset = 0; await refresh(); });
  mediaFilters.forEach((button) => button.addEventListener('click', async () => { activeMediaFilter = button.dataset.mediaFilter ?? 'all'; page.offset = 0; await refresh(); }));
  mediaPrev.addEventListener('click', async () => { page.offset = Math.max(0, page.offset - page.limit); await refresh(); });
  mediaNext.addEventListener('click', async () => { page.offset += page.limit; await refresh(); });
  listNode.addEventListener('click', async (event) => { const downloadKey = event.target.closest('[data-download-key]')?.dataset.downloadKey; const eagleKey = event.target.closest('[data-eagle-key]')?.dataset.eagleKey; if (downloadKey) await chooseAndDownload(downloadTargets(items, downloadKey)); if (eagleKey) await importToEagle(eagleTargets(items, eagleKey, false)); });
  chrome.runtime.sendMessage({ type: 'RESET_SESSION' }).then(refresh); refreshEagle();
  setInterval(refresh, 1000);
}

if (typeof chrome !== 'undefined') mount();
