import { downloadFilename } from '../shared/media.js';
import { eagleImportPayload, isEagleImportable, tweetSourceUrl } from '../shared/eagle.js';
import { telegramEagleItem } from '../shared/telegram-media.js';
import { createTelegramEagleController } from './telegram-eagle.js';
import { addMedia, appendLog, createTask, loadTask, saveTask, setEagleImport, setEagleItemStatus, setItemStatus, setTaskPhase, taskSummary } from '../shared/task-store.js';

if (typeof chrome !== 'undefined' && chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

if (typeof chrome !== 'undefined' && chrome.downloads) {
  chrome.downloads.onCreated.addListener((item) => { telegramEagle?.onDownloadCreated(item).catch(() => {}); });
  chrome.downloads.onChanged.addListener(async (delta) => {
    if (delta.state?.current !== 'complete') return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item) await telegramEagle?.onDownloadChanged(delta, item);
  });
}

if (typeof chrome !== 'undefined' && chrome.alarms && chrome.downloads) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    const match = /^telegram-eagle-cleanup-(\d+)$/.exec(alarm.name);
    if (match) removeTelegramDownloadCleanup(Number(match[1])).catch(() => {});
  });
}

let liveScanningUsername = null;
const eagleBaseUrl = 'http://localhost:41595';
const nativeEagleHost = 'com.x_media_downloader.eagle';
const telegramCleanupKey = 'telegramEagle:cleanup';
const telegramCleanupDelay = 120_000;

function telegramCleanupAlarmName(downloadId) { return `telegram-eagle-cleanup-${downloadId}`; }

async function scheduleTelegramDownloadCleanup(downloadId, when = Date.now() + telegramCleanupDelay) {
  if (!chrome.alarms) return;
  const cleanup = (await chrome.storage.local.get(telegramCleanupKey))[telegramCleanupKey] ?? {};
  await chrome.storage.local.set({ [telegramCleanupKey]: { ...cleanup, [downloadId]: { when } } });
  chrome.alarms.create(telegramCleanupAlarmName(downloadId), { when });
}

async function removeTelegramDownloadCleanup(downloadId) {
  const cleanup = (await chrome.storage.local.get(telegramCleanupKey))[telegramCleanupKey] ?? {};
  try {
    await chrome.downloads.removeFile(downloadId);
    delete cleanup[downloadId];
    await chrome.storage.local.set({ [telegramCleanupKey]: cleanup });
  } catch {
    await scheduleTelegramDownloadCleanup(downloadId, Date.now() + 60_000);
  }
}

async function restoreTelegramDownloadCleanup() {
  if (!chrome.alarms) return;
  const cleanup = (await chrome.storage.local.get(telegramCleanupKey))[telegramCleanupKey] ?? {};
  for (const [id, entry] of Object.entries(cleanup)) {
    chrome.alarms.create(telegramCleanupAlarmName(id), { when: Math.max(Date.now() + 1_000, entry.when ?? Date.now()) });
  }
}

restoreTelegramDownloadCleanup().catch(() => {});
const telegramEagle = typeof chrome === 'undefined' ? null : createTelegramEagleController({
  storage: chrome.storage.local,
  ensureFolder: ensureEagleNamedFolder,
  importLocalItem: async (record, localPath, folderId) => {
    const result = await importEagleLocally([telegramEagleItem(record, localPath)], '', folderId);
    if ((result?.imported ?? 0) !== 1) throw new Error(result?.failed?.[0]?.error ?? 'Eagle 未导入该媒体');
  },
  sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  removeDownloadFile: (id) => chrome.downloads.removeFile(id),
  scheduleRemoveDownloadFile: scheduleTelegramDownloadCleanup,
  scheduleNativeExpiry: (requestId) => setTimeout(() => telegramEagle?.expireNativeDownload(requestId).catch(() => {}), 20_000)
});
// Eagle can process remote URLs steadily in small continuous groups.  Sending
// thousands in one request makes its own remote-import queue crawl.
const eagleImportBatchSize = 50;

export async function importEagleItems(items = [], username = '', folderId = null, fetchImpl = fetch, allowReimport = false, { onBatch = () => {} } = {}) {
  const result = new Array(items.length);
  const candidates = items.map((item, sourceIndex) => ({ item, sourceIndex })).filter(({ item }) => isEagleImportable(item, allowReimport) && item.kind !== 'hls');
  let completed = 0;
  for (let index = 0; index < candidates.length; index += eagleImportBatchSize) {
    const sourceBatch = candidates.slice(index, index + eagleImportBatchSize);
    const batch = sourceBatch;
    try {
      if (batch.length) {
        const response = await fetchImpl(`${eagleBaseUrl}/api/item/addFromURLs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch.map(({ item }) => eagleImportPayload(item, username)), ...(folderId ? { folderId } : {}) })
        });
        if (!response.ok) throw new Error(`Eagle 导入失败（HTTP ${response.status}）`);
        const payload = await response.json();
        if (payload?.status !== 'success') throw new Error(`Eagle 拒绝导入：${payload?.message ?? '未返回成功状态'}`);
        batch.forEach(({ item, sourceIndex }) => { result[sourceIndex] = { key: item.key, ok: true }; });
      }
    } catch (error) {
      batch.forEach(({ item, sourceIndex }) => { result[sourceIndex] = { key: item.key, ok: false, error: error.message }; });
    }
    completed += sourceBatch.length;
    onBatch({ completed, total: candidates.length });
  }
  return result.filter(Boolean);
}

export async function eagleRecentFolders(fetchImpl = fetch) {
  const response = await fetchImpl(`${eagleBaseUrl}/api/folder/listRecent`);
  if (!response.ok) throw new Error(`无法连接 Eagle（HTTP ${response.status}）`);
  const payload = await response.json();
  const folders = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return folders.filter((folder) => folder?.id && folder?.name).map((folder) => ({ id: folder.id, name: folder.name }));
}

export async function eagleFolderItemCount(folderId, fetchImpl = fetch) {
  if (!folderId) return 0;
  const hasItemAt = async (offset) => {
    const query = new URLSearchParams({ limit: '1', offset: String(offset), folders: folderId });
    const response = await fetchImpl(`${eagleBaseUrl}/api/item/list?${query}`);
    if (!response.ok) throw new Error(`无法读取 Eagle 文件夹内容（HTTP ${response.status}）`);
    const payload = await response.json();
    return Array.isArray(payload?.data) && payload.data.length > 0;
  };
  if (!await hasItemAt(0)) return 0;
  let low = 0;
  let high = 1;
  while (await hasItemAt(high)) { low = high; high *= 2; }
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await hasItemAt(middle)) low = middle;
    else high = middle;
  }
  return low + 1;
}

export async function eagleAvailability(fetchImpl = fetch) {
  try {
    return { available: true, folders: await eagleRecentFolders(fetchImpl) };
  } catch (error) {
    return { available: false, folders: [], error: `未检测到 Eagle：请先打开 Eagle 桌面应用（${error.message}）` };
  }
}

export async function nativeEagleAvailability(sendNativeMessage = (message) => chrome.runtime.sendNativeMessage(nativeEagleHost, message)) {
  try {
    const result = await sendNativeMessage({ type: 'PING' });
    return { available: result?.type === 'PONG' };
  } catch (error) { return { available: false, error: error.message }; }
}

export function nativeImportChunks(items = [], size = 50) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export async function importEagleLocally(items, username, folderId, { connectNative = () => chrome.runtime.connectNative(nativeEagleHost), onProgress = () => {}, strictContentDedup = false } = {}) {
  const port = connectNative();
  const localItems = items.filter((item) => item.localPath || (['image', 'video', 'hls'].includes(item.kind) && item.url));
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error) => { if (!finished) { finished = true; reject(error instanceof Error ? error : new Error(error)); } };
    port.onDisconnect.addListener(() => { if (!finished) fail(chrome.runtime.lastError?.message || '本地导入助手已断开'); });
    port.onMessage.addListener((message) => {
      if (message.type === 'READY') { for (const chunk of nativeImportChunks(localItems)) port.postMessage({ type: 'CHUNK', items: chunk }); port.postMessage({ type: 'COMMIT' }); }
      if (message.type === 'PROGRESS') onProgress(message);
      if (message.type === 'ERROR') fail(message.error || '本地导入失败');
      if (message.type === 'COMPLETE') { finished = true; resolve(message); }
    });
    port.postMessage({ type: 'START', taskId: crypto.randomUUID(), username, folderId, strictContentDedup });
  });
}

export function isEaglePriorityMessage(type) {
  return type === 'GET_EAGLE_FOLDERS' || type === 'GET_EAGLE_IMPORT_PROGRESS' || type === 'IMPORT_EAGLE_ITEMS' || type === 'IMPORT_EAGLE_LOCAL_ITEMS';
}

export async function ensureEagleNamedFolder(name, fetchImpl = fetch) {
  const listed = await fetchImpl(`${eagleBaseUrl}/api/folder/list`);
  if (!listed.ok) throw new Error(`无法读取 Eagle 文件夹（HTTP ${listed.status}）`);
  const payload = await listed.json();
  const folders = Array.isArray(payload?.data) ? payload.data : [];
  const existing = folders.find((folder) => folder?.name === name && folder?.id);
  if (existing) return { id: existing.id, name, created: false };
  const created = await fetchImpl(`${eagleBaseUrl}/api/folder/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName: name })
  });
  if (!created.ok) throw new Error(`无法创建 Eagle 文件夹（HTTP ${created.status}）`);
  const result = await created.json();
  const folder = result?.data ?? result;
  if (!folder?.id) throw new Error('Eagle 未返回新建文件夹 ID');
  return { id: folder.id, name, created: true };
}

export async function ensureEagleCreatorFolder(username, profileName = '', fetchImpl = fetch) {
  if (typeof profileName === 'function') { fetchImpl = profileName; profileName = ''; }
  const id = `@${String(username ?? '').replace(/^@+/, '')}`;
  const name = String(profileName ?? '').trim();
  const folderName = name ? `${name} ${id}` : id;
  if (!name) return ensureEagleNamedFolder(folderName, fetchImpl);
  const listed = await fetchImpl(`${eagleBaseUrl}/api/folder/list`);
  if (!listed.ok) throw new Error(`无法读取 Eagle 文件夹（HTTP ${listed.status}）`);
  const folders = (await listed.json())?.data ?? [];
  const existing = folders.find((folder) => folder?.name === folderName && folder?.id);
  if (existing) return { id: existing.id, name: folderName, created: false };
  const legacy = folders.find((folder) => folder?.name === id && folder?.id);
  if (legacy) {
    const renamed = await fetchImpl(`${eagleBaseUrl}/api/folder/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: legacy.id, newName: folderName })
    });
    const result = await renamed.json().catch(() => ({}));
    if (!renamed.ok || result?.status !== 'success') throw new Error(result?.message || `Eagle 重命名文件夹失败（HTTP ${renamed.status}）`);
    return { id: legacy.id, name: folderName, created: false, renamed: true };
  }
  return ensureEagleNamedFolder(folderName, fetchImpl);
}

export function createSerialExecutor() {
  let tail = Promise.resolve();
  return (operation) => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
}

export function allowsMediaType(record, mediaType = 'all') {
  return mediaType === 'all' || (mediaType === 'image' ? record.kind === 'image' : record.kind === 'video' || record.kind === 'hls');
}

export function addDiscoveredMedia(task, records = []) {
  return records.reduce((next, record) => addMedia(next, record), task);
}

const runSerialized = createSerialExecutor();

export function createDownloadRunner({ download, concurrency = 3, onUpdate = () => {} }) {
  return {
    async run(items) {
      const result = items.map((item) => ({ ...item }));
      let cursor = 0;
      const worker = async () => {
        while (cursor < result.length) {
          const index = cursor++;
          if (result[index].status !== 'pending') continue;
          result[index] = { ...result[index], status: 'downloading', error: null };
          onUpdate(result[index]);
          try {
            await download({ url: result[index].url, filename: result[index].filename, conflictAction: 'uniquify', saveAs: false });
            result[index] = { ...result[index], status: 'completed' };
          } catch (error) {
            result[index] = { ...result[index], status: 'failed', error: error.message };
          }
          onUpdate(result[index]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, result.length) }, worker));
      return result;
    }
  };
}

export function createBrowserFileRunner({ download, search, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), concurrency = 4, onProgress = () => {} }) {
  async function localFile(downloadId) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const [item] = await search({ id: downloadId });
      if (item?.state === 'complete' && item.filename) return item.filename;
      if (item?.state === 'interrupted') throw new Error(item.error || 'Chrome 下载被中断');
      await wait(250);
    }
    throw new Error('等待 Chrome 下载超时');
  }

  return {
    async run(items, taskId) {
      const complete = [];
      const failures = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length) {
          const index = cursor++;
          const item = items[index];
          try {
            const filename = String(item.filename || `image-${index + 1}.jpg`).split(/[\\/]/).pop();
            const id = await download({ url: item.url, filename: `XMediaEagle/${taskId}/${String(index + 1).padStart(5, '0')}-${filename}`, conflictAction: 'overwrite', saveAs: false });
            complete.push({ ...item, localPath: await localFile(id) });
          } catch (error) {
            failures.push({ key: item.key, error: error.message });
          }
          onProgress({ downloaded: complete.length, failed: failures.length, total: items.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
      return { complete, failures };
    }
  };
}

export async function activeTabId(senderTab, tabs = chrome.tabs) {
  if (senderTab?.id) return senderTab.id;
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

export async function ensureContentScript(tabId, scripting = chrome.scripting) {
  await scripting.executeScript({ target: { tabId }, files: ['src/content/page-bridge.js'], world: 'MAIN' });
  await scripting.executeScript({ target: { tabId }, files: ['src/content/content-script.js'], world: 'ISOLATED' });
}

export async function readXProfileIdentity(tabId, {
  ensure = (id) => ensureContentScript(id),
  send = (id, message) => chrome.tabs.sendMessage(id, message)
} = {}) {
  await ensure(tabId);
  const identity = await send(tabId, { type: 'GET_PROFILE_IDENTITY' });
  const profileName = String(identity?.profileName ?? '').trim();
  if (!profileName) throw new Error('未读取到 X 显示名，请刷新当前用户主页后重试');
  return { profileName };
}

async function activeTask() {
  const { ['x-media-active']: active } = await chrome.storage.local.get('x-media-active');
  return active ? loadTask(active.username) : null;
}

export function collectionStatus(task) {
  return {
    ...taskSummary(task),
    collecting: task.collecting,
    username: task.username,
    phase: task.phase ?? (task.collecting ? 'scanning' : 'scan_complete'),
    scrollMode: task.scrollMode ?? 'manual',
    autoScrollPaused: Boolean(task.autoScrollPaused),
    eagleImport: task.eagleImport ?? null,
    merged: task.collectionStats?.merged ?? 0,
    diagnostic: task.diagnostic,
    logs: task.logs ?? []
  };
}

export function resolveStaleScanningTask(task, liveUsername) {
  // MV3 may suspend the service worker at any time.  The in-memory marker is
  // therefore not authoritative; an explicitly persisted scan stays active
  // until the user presses stop.
  return task;
}

export function emptyStatus() {
  return { total: 0, pending: 0, downloading: 0, completed: 0, failed: 0, unavailable: 0, phase: 'idle', collecting: false, scrollMode: 'manual', autoScrollPaused: false, logs: [] };
}

function mediaAssetId(url) {
  return String(url ?? '').match(/(?:amplify_video|ext_tw_video)(?:_thumb)?\/(\d+)/)?.[1] ?? null;
}

export function matchPlaylistToVideoItem(items, playlistUrl) {
  const assetId = mediaAssetId(playlistUrl);
  if (!assetId) return null;
  return items.find((item) => item.kind === 'video' && item.needsResolve && !item.url && mediaAssetId(item.poster) === assetId) ?? null;
}

export async function resolveTweetVideo(tweetId, mediaIndex, fetchImpl = fetch) {
  const response = await fetchImpl(`https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweetId)}&token=x`);
  if (!response.ok) throw new Error(`视频元数据请求失败（HTTP ${response.status}）`);
  const payload = await response.json();
  if (payload?.__typename === 'TweetTombstone') throw Object.assign(new Error('X 未向公开接口提供该视频元数据，等待播放器播放清单'), { code: 'TWEET_TOMBSTONE' });
  const media = payload.mediaDetails ?? payload.media ?? [];
  const entry = media[mediaIndex] ?? media.find((item) => item.type === 'video' || item.type === 'animated_gif');
  const variants = entry?.video_info?.variants ?? entry?.video?.variants ?? [];
  const best = variants
    .filter((variant) => variant?.content_type === 'video/mp4' && Number.isFinite(variant.bitrate))
    .sort((left, right) => right.bitrate - left.bitrate)[0];
  if (best) return { url: best.url, bitrate: best.bitrate };
  const hls = variants.find((variant) => variant?.content_type === 'application/x-mpegURL');
  if (hls) return { url: hls.url, kind: 'hls', extension: 'm3u8', notice: '仅保存 HLS 播放清单，离线播放仍依赖远端分片' };
  throw new Error('该视频没有可下载的 MP4 或 HLS 播放清单版本');
}

export function itemsForDirectoryDownload(task) {
  const counters = new Map();
  return [...task.items]
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.key.localeCompare(right.key))
    .map((item) => {
      const date = new Date(item.createdAt).toISOString().slice(0, 10);
      const number = (counters.get(date) ?? 0) + 1;
      counters.set(date, number);
      return { ...item, username: task.username, filename: downloadFilename(task.username, item.createdAt, number, item.extension ?? (item.kind === 'video' || item.kind === 'hls' ? 'mp4' : 'jpg'), 0, item.tweetText) };
    });
}

export function taskItemsPage(task, { tab = 'downloadable', mediaType = 'all', offset = 0, limit = 80 } = {}) {
  const numbered = itemsForDirectoryDownload(task);
  const downloadable = numbered.filter((item) => item.status !== 'unavailable');
  const unavailable = numbered.filter((item) => item.status === 'unavailable');
  const inTab = tab === 'unavailable' ? unavailable : downloadable;
  const filtered = inTab.filter((item) => allowsMediaType(item, mediaType));
  const start = Math.max(0, Number(offset) || 0);
  const pageSize = Math.max(1, Math.min(100, Number(limit) || 80));
  return {
    items: filtered.slice(start, start + pageSize),
    total: filtered.length,
    offset: start,
    limit: pageSize,
    counts: {
      all: numbered.length,
      downloadable: downloadable.length,
      unavailable: unavailable.length,
      eagleImportable: downloadable.filter((item) => isEagleImportable(item, true)).length,
      eagleImported: numbered.filter((item) => item.eagleStatus === 'imported').length,
      hls: numbered.filter((item) => item.kind === 'hls').length
    }
  };
}

async function updateActive(task) {
  await saveTask(task);
  await chrome.storage.local.set({ 'x-media-active': { username: task.username, options: task.options, collecting: task.collecting, scrollMode: task.scrollMode } });
  return collectionStatus(task);
}

async function importEagleTask(message) {
  const task = await activeTask();
  if (!task) throw new Error('没有可导入的采集任务');
  const profileName = String(message.profileName ?? task.profileName ?? '').trim();
  if (!profileName) throw new Error('未读取到 X 显示名，暂不保存到 Eagle；请刷新当前用户主页后重试');
  const taskForImport = profileName === task.profileName ? task : { ...task, profileName };
  if (taskForImport !== task) await updateActive(taskForImport);
  const candidates = itemsForDirectoryDownload(taskForImport).filter((item) => (message.keys ?? []).includes(item.key));
  const folder = await ensureEagleCreatorFolder(taskForImport.username, profileName);
  const baseline = await eagleFolderItemCount(folder.id);
  const urlCandidates = candidates.filter((item) => item.kind !== 'hls');
  const hlsCandidates = candidates.filter((item) => item.kind === 'hls');
  const urlImported = urlCandidates.length ? await importEagleItems(urlCandidates, taskForImport.username, folder.id, fetch, Boolean(message.allowReimport)) : [];
  const localResult = hlsCandidates.length ? await importEagleLocally(hlsCandidates, taskForImport.username, folder.id) : { imported: 0, deduplicated: 0, failed: [] };
  return runSerialized(async () => {
    const latest = await activeTask();
    if (!latest) throw new Error('导入完成前任务已被清除');
    const urlSucceeded = urlImported.filter((item) => item.ok && !item.skipped).length;
    const urlSkipped = urlImported.filter((item) => item.ok && item.skipped).length;
    const urlFailed = urlImported.filter((item) => !item.ok);
    const succeeded = urlSucceeded + localResult.imported;
    const skipped = urlSkipped;
    const failed = [...urlFailed, ...(localResult.failed || [])];
    let next = appendLog({ ...latest, profileName }, `${folder.created ? '已创建' : '已复用'} Eagle 文件夹 ${folder.name}；已提交 ${succeeded} 项（HLS ${localResult.imported} 项走本地合并），提交失败 ${failed.length} 项；Eagle 将继续处理远程资源`);
    next = setEagleImport(next, { folderId: folder.id, folderName: folder.name, baseline, submitted: succeeded, failed: failed.length, observed: baseline, startedAt: new Date().toISOString() });
    for (const item of urlImported) next = setEagleItemStatus(next, item.key, item.ok ? 'submitted' : 'failed', item.error ?? null);
    for (const item of hlsCandidates) next = setEagleItemStatus(next, item.key, 'submitted');
    for (const item of failed) next = setEagleItemStatus(next, item.key, 'failed', item.error ?? item.message ?? '未知错误');
    for (const item of failed) next = appendLog(next, `Eagle 导入失败：${item.error ?? item.message ?? '未知错误'}`);
    await updateActive(next);
    return { submitted: succeeded, skipped, failed: failed.length, folder, baseline, failures: failed };
  });
}

async function eagleImportProgress() {
  const task = await activeTask();
  const progress = task?.eagleImport;
  if (!progress?.folderId) return null;
  const observed = await eagleFolderItemCount(progress.folderId);
  const added = Math.min(progress.submitted ?? 0, Math.max(0, observed - (progress.baseline ?? observed)));
  return { ...progress, observed, added, unresolved: Math.max(0, (progress.submitted ?? 0) - added) };
}

async function importEagleLocalTask(message) {
  const task = await activeTask();
  if (!task) throw new Error('没有可导入的采集任务');
  const candidates = itemsForDirectoryDownload(task).filter((item) => (message.keys ?? []).includes(item.key) && item.kind === 'image');
  const folder = await ensureEagleCreatorFolder(task.username, task.profileName);
  const baseline = await eagleFolderItemCount(folder.id);
  const localTaskId = crypto.randomUUID();
  await runSerialized(async () => {
    const latest = await activeTask();
    if (!latest) throw new Error('本地导入开始前任务已被清除');
    let next = appendLog(latest, `开始本地高速导入：将通过 Chrome 下载 ${candidates.length} 张图片，再交给 Eagle`);
    next = setEagleImport(next, { folderId: folder.id, folderName: folder.name, baseline, submitted: 0, failed: 0, observed: baseline, startedAt: new Date().toISOString(), local: true, phase: 'browser_downloading', downloaded: 0, total: candidates.length });
    await updateActive(next);
  });
  const browserFiles = await createBrowserFileRunner({
    download: (options) => chrome.downloads.download(options),
    search: (query) => chrome.downloads.search(query),
    onProgress: ({ downloaded, failed, total }) => runSerialized(async () => {
      const latest = await activeTask();
      if (!latest) return;
      const next = setEagleImport(latest, { ...latest.eagleImport, phase: 'browser_downloading', downloaded, failed, total });
      await updateActive(next);
    })
  }).run(candidates, localTaskId);
  const result = await importEagleLocally(browserFiles.complete, task.username, folder.id, { strictContentDedup: Boolean(message.strictContentDedup) });
  result.failed = [...browserFiles.failures, ...(result.failed ?? [])];
  return runSerialized(async () => {
    const latest = await activeTask();
    let next = appendLog(latest, `本地高速导入完成：已交给 Eagle ${result.imported} 项，内容去重 ${result.deduplicated ?? 0} 项，下载失败 ${result.failed.length} 项`);
    next = setEagleImport(next, { folderId: folder.id, folderName: folder.name, baseline, submitted: result.imported, failed: result.failed.length, deduplicated: result.deduplicated ?? 0, observed: baseline, startedAt: new Date().toISOString(), local: true });
    for (const item of candidates) next = setEagleItemStatus(next, item.key, 'submitted');
    for (const failure of result.failed) next = setEagleItemStatus(next, failure.key, 'failed', failure.error);
    await updateActive(next);
    return { submitted: result.imported, failed: result.failed.length, folder, baseline, failures: result.failed };
  });
}

async function startDownloads(task) {
  const pending = task.items.filter((item) => item.status === 'pending' && item.url).map((item) => ({
    ...item,
    filename: downloadFilename(task.username, item.createdAt, item.mediaIndex + 1, item.extension ?? (item.kind === 'video' ? 'mp4' : 'jpg'), 0, item.tweetText)
  }));
  const runner = createDownloadRunner({
    download: (options) => chrome.downloads.download(options),
    onUpdate: async (updated) => {
      task = setItemStatus(task, updated.key, updated.status, updated.error);
      await updateActive(task);
    }
  });
  await runner.run(pending);
  return updateActive(task);
}

if (typeof chrome !== 'undefined') {
  chrome.webRequest?.onBeforeRequest.addListener(({ url }) => {
    if (!/\.m3u8(?:[?#]|$)/i.test(url)) return;
    runSerialized(async () => {
      const task = await activeTask();
      if (!task?.collecting) return;
      liveScanningUsername = task.username;
      const item = matchPlaylistToVideoItem(task.items, url);
      if (!item) return;
      const record = {
        ...item,
        key: `${item.tweetId}:${item.mediaIndex}:${url}`,
        kind: 'hls',
        url,
        extension: 'm3u8',
        needsResolve: false,
        status: 'pending',
        error: null,
        notice: '仅保存 HLS 播放清单，离线播放仍依赖远端分片'
      };
      await updateActive(appendLog(addMedia(task, record), `已从播放器捕获 HLS 播放清单：推文 ${item.tweetId}`));
    }).catch(() => {});
  }, { urls: ['https://video.twimg.com/*'] });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TELEGRAM_REGISTER_DOWNLOAD') {
      telegramEagle.register({ ...message, tabId: sender.tab?.id }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === 'TELEGRAM_START_DIRECT_DOWNLOAD') {
      chrome.downloads.download({ url: message.url, filename: message.filename, conflictAction: 'uniquify', saveAs: false })
        .then(async (downloadId) => {
          await telegramEagle.assignDownloadId(message.requestId, downloadId);
          sendResponse({ downloadId });
        })
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === 'GET_EAGLE_FOLDERS') {
      eagleAvailability().then(sendResponse).catch((error) => sendResponse({ available: false, folders: [], error: error.message }));
      return true;
    }
    if (message.type === 'GET_EAGLE_IMPORT_PROGRESS') {
      eagleImportProgress().then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === 'GET_X_PROFILE_IDENTITY') {
      readXProfileIdentity(message.tabId).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === 'GET_NATIVE_EAGLE_STATUS') {
      nativeEagleAvailability().then(sendResponse).catch((error) => sendResponse({ available: false, error: error.message }));
      return true;
    }
    if (message.type === 'IMPORT_EAGLE_ITEMS') {
      importEagleTask(message).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === 'IMPORT_EAGLE_LOCAL_ITEMS') {
      importEagleLocalTask(message).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    runSerialized(async () => {
      if (message.type === 'START_COLLECTION') {
        const task = appendLog(createTask(message.username, { ...message.options, scrollMode: message.scrollMode, profileName: message.profileName }), `开始${message.scrollMode === 'auto' ? '自动' : '手动'}滚动采集，向当前 X 页面发送首屏扫描命令`);
        await updateActive(task);
        liveScanningUsername = task.username;
        const tabId = await activeTabId(sender.tab);
        if (tabId) {
          try {
            await ensureContentScript(tabId);
            await chrome.tabs.sendMessage(tabId, { type: 'SCAN_VISIBLE_ARTICLES' });
            if (task.scrollMode === 'auto') await chrome.tabs.sendMessage(tabId, { type: 'START_AUTO_SCROLL' });
          } catch (error) {
            await updateActive(appendLog(task, `内容脚本注入或扫描命令发送失败：${error.message}`));
          }
        }
        return collectionStatus(task);
      }
      if (message.type === 'MEDIA_DISCOVERED' || message.type === 'MEDIA_DISCOVERED_BATCH') {
        const task = await activeTask();
        if (!task?.collecting) return null;
        liveScanningUsername = task.username;
        const records = (message.type === 'MEDIA_DISCOVERED_BATCH' ? message.records : [message.record]).filter((record) => record && allowsMediaType(record, task.options?.mediaType));
        if (!records.length) return null;
        const directRecords = records.filter((record) => !record.needsResolve);
        let next = addDiscoveredMedia(task, directRecords);
        const added = next.items.length - task.items.length;
        if (directRecords.length) await updateActive(added ? appendLog(next, `批量收到 ${directRecords.length} 个媒体，新增 ${added} 个`) : next);
        for (const recordToResolve of records.filter((record) => record.needsResolve)) {
          const current = await activeTask();
          if (!current) return null;
          next = addMedia(current, recordToResolve);
          await updateActive(appendLog(next, `发现视频，正在解析最高码率 MP4：推文 ${recordToResolve.tweetId}`));
          try {
          const resolved = await resolveTweetVideo(recordToResolve.tweetId, recordToResolve.mediaIndex);
          const latest = await activeTask();
          if (!latest) return null;
          const resolvedRecord = { ...recordToResolve, ...resolved, key: `${recordToResolve.tweetId}:${recordToResolve.mediaIndex}:${resolved.url}`, kind: resolved.kind ?? 'video', extension: resolved.extension ?? 'mp4', needsResolve: false, status: 'pending', error: null };
          await updateActive(appendLog(addMedia(latest, resolvedRecord), `已解析最高码率 MP4：推文 ${recordToResolve.tweetId}`));
        } catch (error) {
          const latest = await activeTask();
          if (!latest) return null;
          if (error.code === 'TWEET_TOMBSTONE') { await updateActive(appendLog(latest, `视频公开元数据不可用，等待播放器播放清单：推文 ${recordToResolve.tweetId}`)); continue; }
          await updateActive(appendLog(setItemStatus(latest, recordToResolve.key, 'unavailable', error.message), `视频无法下载：推文 ${recordToResolve.tweetId}，${error.message}`));
        }
        }
        return collectionStatus(await activeTask());
      }
      if (message.type === 'COLLECTION_DIAGNOSTIC') {
        const task = await activeTask();
        if (!task?.collecting) return null;
        liveScanningUsername = task.username;
        return updateActive(appendLog({ ...task, diagnostic: message.diagnostic }, `内容脚本扫描：${message.diagnostic.articles} 条卡片，${message.diagnostic.records} 个图片节点`));
      }
      if (message.type === 'COLLECTION_LOG') {
        const task = await activeTask();
        if (!task?.collecting) return null;
        liveScanningUsername = task.username;
        return updateActive(appendLog(task, message.message));
      }
      const storedTask = await activeTask();
      if (message.type === 'RESET_SESSION') {
        if (storedTask?.collecting) {
          liveScanningUsername = storedTask.username;
          const tabId = await activeTabId(sender.tab);
          if (tabId) {
            try {
              await ensureContentScript(tabId);
              await chrome.tabs.sendMessage(tabId, { type: 'SCAN_VISIBLE_ARTICLES' });
              if (storedTask.scrollMode === 'auto') await chrome.tabs.sendMessage(tabId, { type: 'START_AUTO_SCROLL' });
            } catch { /* 内容脚本不可达时保留当前状态，由用户决定停止或重试 */ }
          }
          return collectionStatus(storedTask);
        }
        const tabId = await activeTabId(sender.tab);
        if (tabId) chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTO_SCROLL' }).catch(() => {});
        liveScanningUsername = null;
        await chrome.storage.local.remove('x-media-active');
        return emptyStatus();
      }
      const task = resolveStaleScanningTask(storedTask, liveScanningUsername);
      if (!task) return emptyStatus();
      if (task !== storedTask) return updateActive(appendLog(task, '检测到旧扫描任务，已停止；请点击“开始扫描”继续'));
      if (message.type === 'GET_TASK_ITEMS') {
        if (message.all) return { items: itemsForDirectoryDownload(task), total: task.items.length };
        return taskItemsPage(task, message);
      }
      if (message.type === 'AUTO_SCROLL_FINISHED') {
        if (!task.collecting || task.scrollMode !== 'auto') return collectionStatus(task);
        liveScanningUsername = null;
        return updateActive(appendLog(setTaskPhase({ ...task, autoScrollPaused: false }, 'scan_complete'), '自动滚动已连续到底，扫描完成；请确认媒体数量后下载或保存到 Eagle'));
      }
      if (message.type === 'STOP_COLLECTION') {
        const tabId = await activeTabId(sender.tab);
        if (tabId) chrome.tabs.sendMessage(tabId, { type: 'STOP_AUTO_SCROLL' }).catch(() => {});
        liveScanningUsername = null;
        return updateActive(appendLog(setTaskPhase({ ...task, autoScrollPaused: false }, 'scan_complete'), '扫描已停止；请确认媒体数量后选择文件夹下载'));
      }
      if (message.type === 'PAUSE_AUTO_SCROLL' || message.type === 'RESUME_AUTO_SCROLL') {
        const paused = message.type === 'PAUSE_AUTO_SCROLL';
        const tabId = await activeTabId(sender.tab);
        if (tabId) chrome.tabs.sendMessage(tabId, { type: message.type }).catch(() => {});
        return updateActive(appendLog({ ...task, autoScrollPaused: paused }, paused ? '已暂停自动滚动' : '已继续自动滚动'));
      }
      if (message.type === 'BEGIN_DIRECTORY_DOWNLOAD') {
        const hasPending = task.items.some((item) => item.status === 'pending' && item.url);
        return updateActive(appendLog(setTaskPhase(task, hasPending ? 'downloading' : 'complete'), hasPending ? '已选择目标文件夹，开始下载媒体文件' : '没有可下载的媒体文件'));
      }
      if (message.type === 'DOWNLOAD_ITEM_STATUS') {
        const next = setItemStatus(task, message.key, message.status, message.error ?? null);
        const completed = !next.items.some((item) => item.status === 'pending' || item.status === 'downloading');
        return updateActive(appendLog(setTaskPhase(next, completed ? 'complete' : 'downloading'), message.log ?? `${message.status}：${message.key}`));
      }
      if (message.type === 'START_DOWNLOADS') return startDownloads({ ...task, collecting: false });
      if (message.type === 'PREPARE_RETRY_FAILED') {
        const retried = { ...task, items: task.items.map((item) => item.status === 'failed' ? { ...item, status: 'pending', error: null } : item) };
        return updateActive(appendLog(setTaskPhase(retried, 'scan_complete'), '已将失败项加入待下载队列，请选择文件夹重试'));
      }
      return collectionStatus(task);
    }).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  });
}
