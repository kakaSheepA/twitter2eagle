(() => {
  if (globalThis.__telegramEagleContentInstalled) return;
  globalThis.__telegramEagleContentInstalled = true;

function telegramMediaKey({ peerId, messageId, kind }) {
  return `telegram:${peerId}:${messageId}:${kind}`;
}

function telegramDownloadFilename({ messageId, extension }, requestId) {
  return `TelegramEagle_${requestId}_${messageId}.${extension === 'mp4' ? 'mp4' : 'jpg'}`;
}

let waitingForVideoKey = null;
const playedVideoSources = new Map();

function viewerRecord(video) {
  const source = video?.currentSrc || video?.src;
  if (!source) return null;
  let hash = 5381;
  for (const character of source) hash = ((hash * 33) ^ character.charCodeAt(0)) >>> 0;
  const messageId = `viewer-${hash.toString(36)}`;
  const website = typeof location === 'undefined' ? undefined : location.href;
  return { peerId: 'viewer', messageId, kind: 'video', extension: 'mp4', source, website, key: telegramMediaKey({ peerId: 'viewer', messageId, kind: 'video' }) };
}

async function downloadUrlForSource(source, fetchImpl = fetch, createObjectURL = URL.createObjectURL) {
  if (!String(source).startsWith('blob:')) return { url: source, revoke: false };
  try {
    const response = await fetchImpl(source);
    if (!response.ok) throw new Error(`无法读取视频数据（HTTP ${response.status ?? '未知'}）`);
    const blob = await response.blob();
    if (!blob?.size) throw new Error('视频数据为空，请完整播放后重试');
    return { url: createObjectURL(blob), revoke: true };
  } catch (error) {
    const url = networkVideoUrl();
    if (url) return { url, revoke: false };
    throw new Error(`无法取得真实视频地址：${error.message}`);
  }
}

function networkVideoUrl(entries = performance.getEntriesByType('resource')) {
  return [...entries]
    .filter((entry) => /^(fetch|xmlhttprequest|other|media)$/.test(entry.initiatorType || ''))
    .filter((entry) => /^https:\/\//.test(entry.name || '') && /(telegram(?:-cdn)?\.org|\/file\/|\.mp4(?:[?#]|$))/i.test(entry.name))
    .sort((left, right) => (right.startTime || 0) - (left.startTime || 0))[0]?.name ?? null;
}

function telegramViewerDownloadButton(video) {
  const scope = video.closest('[role="dialog"], .media-viewer, .popup') || document;
  return [...scope.querySelectorAll('button, a')].find((element) => {
    const labels = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-tooltip'), element.className, element.innerHTML].filter(Boolean).join(' ');
    return /download|下载/i.test(labels);
  }) ?? null;
}

function mediaRecord(node) {
  if (node.closest('.is-protected, .is-view-once, .document, .gif, .video-note')) return null;
  const bubble = node.closest('.bubble[data-peer-id][data-mid]');
  if (!bubble) return null;
  const albumItem = node.closest('.album-item[data-mid]');
  if (node === bubble && !albumItem && bubble.querySelector('.album-item[data-mid]')) return null;
  const mediaScope = albumItem || bubble;
  const video = mediaScope.querySelector('video');
  // Telegram renders a video's cover as an image before (and sometimes beside)
  // the real video element.  A cover is not a downloadable video.
  const isVideo = bubble.classList.contains('video') || Boolean(video);
  if (!isVideo) return null;
  if (isVideo && !video) {
    const peerId = bubble.dataset.peerId;
    const messageId = albumItem?.dataset.mid || bubble.dataset.mid;
    return { peerId, messageId, kind: 'video', extension: 'mp4', source: null, key: telegramMediaKey({ peerId, messageId, kind: 'video' }) };
  }
  const media = video;
  const source = media.currentSrc || media.src;
  if (!source) return null;
  const kind = 'video';
  const messageId = albumItem?.dataset.mid || bubble.dataset.mid;
  const peerId = bubble.dataset.peerId;
  const extension = kind === 'video' ? 'mp4' : 'jpg';
  return { peerId, messageId, kind, extension, source, key: telegramMediaKey({ peerId, messageId, kind }) };
}

const MEDIA_SELECTOR = '.bubble.video[data-peer-id][data-mid], .bubble.video[data-peer-id][data-mid] .album-item[data-mid], .bubble[data-peer-id][data-mid] video';

function mediaNodesFromRoot(root) {
  if (!root?.querySelectorAll) return [];
  const ownMedia = root.nodeType === 1 && root.matches(MEDIA_SELECTOR) ? [root] : [];
  return [...ownMedia, ...root.querySelectorAll(MEDIA_SELECTOR)];
}

function recordsFromTelegramRoot(root) {
  const nodes = mediaNodesFromRoot(root);
  const records = new Map();
  for (const record of nodes.map(mediaRecord)) {
    if (!record) continue;
    const previous = records.get(record.key);
    if (!previous || (!previous.source && record.source)) records.set(record.key, record);
  }
  return [...records.values()];
}

function controlFor(record, resolveRecord = () => record, nativeDownloadButton = null) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'telegram-eagle-control'; button.dataset.telegramEagleKey = record.key; button.textContent = '保存到 Eagle'; button.title = '保存到 Eagle';
  button.addEventListener('click', async () => {
    const resolvedRecord = resolveRecord() || record;
    const source = resolvedRecord.source || playedVideoSources.get(resolvedRecord.key);
    if (!source) {
      waitingForVideoKey = resolvedRecord.key;
      button.textContent = '播放后保存';
      button.title = '请先播放视频，加载完成后再点击保存';
      return;
    }
    const activeRecord = { ...resolvedRecord, source };
    try {
      const nativeButton = nativeDownloadButton?.();
      if (nativeDownloadButton && !nativeButton) throw new Error('未找到 Telegram 原生下载按钮');
      const requestId = crypto.randomUUID(); const filename = telegramDownloadFilename(activeRecord, requestId);
      const result = await chrome.runtime.sendMessage({ type: 'TELEGRAM_REGISTER_DOWNLOAD', requestId, record: activeRecord, filename, native: Boolean(nativeButton) });
      if (result?.state === 'saved') { button.textContent = '已保存'; button.title = '已保存'; button.disabled = true; return; }
      if (result?.error) throw new Error(result.error);
      if (nativeButton) {
        nativeButton.click();
        button.disabled = true; button.textContent = '保存中…';
        return;
      }
      const download = await downloadUrlForSource(activeRecord.source);
      if (download.url.startsWith('https://web.telegram.org/')) {
        const started = await chrome.runtime.sendMessage({ type: 'TELEGRAM_START_DIRECT_DOWNLOAD', requestId, url: download.url, filename });
        if (started?.error) throw new Error(started.error);
        button.disabled = true; button.textContent = '保存中…';
        return;
      }
      const link = document.createElement('a'); link.href = download.url; link.download = filename; link.style.display = 'none'; document.body.append(link); link.click(); link.remove();
      if (download.revoke) setTimeout(() => URL.revokeObjectURL(download.url), 60_000);
      button.disabled = true; button.textContent = '保存中…';
    } catch (error) { button.textContent = '重试'; button.title = error.message || '无法开始保存'; }
  });
  return button;
}

function mountTelegramControls(root = document) {
  for (const record of recordsFromTelegramRoot(root)) {
    const media = mediaNodesFromRoot(root).find((element) => mediaRecord(element)?.key === record.key);
    const host = media?.matches('.bubble[data-peer-id][data-mid]') ? media : media?.parentElement;
    const alreadyMounted = [...document.querySelectorAll('.telegram-eagle-control')].some((button) => button.dataset.telegramEagleKey === record.key);
    if (!host || alreadyMounted) continue;
    host.classList.add('telegram-eagle-host'); host.append(controlFor(record, () => mediaRecord(media)));
  }
}

function mountViewerControl(video) {
  if (video.closest('.bubble[data-peer-id][data-mid]')) return;
  const record = viewerRecord(video);
  if (!record) return;
  const controls = [...document.querySelectorAll('.telegram-eagle-viewer-control')];
  if (controls.some((button) => button.dataset.telegramEagleKey === record.key)) return;
  controls.forEach((button) => button.remove());
  const button = controlFor(record, () => viewerRecord(video), () => telegramViewerDownloadButton(video));
  button.classList.add('telegram-eagle-viewer-control');
  document.body.append(button);
}

globalThis.TelegramEagleContent = { recordsFromTelegramRoot, mountTelegramControls, viewerRecord, downloadUrlForSource, networkVideoUrl, telegramViewerDownloadButton };

if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
  mountTelegramControls();
  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    mountTelegramControls(node);
    if (node.matches('video')) mountViewerControl(node);
    node.querySelectorAll?.('video').forEach(mountViewerControl);
  })))
    .observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('loadedmetadata', (event) => { if (event.target.matches?.('video')) mountViewerControl(event.target); }, true);
  document.addEventListener('canplay', (event) => { if (event.target.matches?.('video')) mountViewerControl(event.target); }, true);
  document.addEventListener('play', (event) => {
    const video = event.target;
    if (!video.matches?.('video')) return;
    mountViewerControl(video);
    const source = video.currentSrc || video.src;
    const key = mediaRecord(video)?.key || waitingForVideoKey;
    if (!key || !source) return;
    playedVideoSources.set(key, source);
    waitingForVideoKey = null;
    document.querySelectorAll('.telegram-eagle-control').forEach((button) => {
      if (button.dataset.telegramEagleKey === key && !button.disabled) { button.textContent = '保存到 Eagle'; button.title = '保存到 Eagle'; }
    });
  }, true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'TELEGRAM_SAVE_STATE') return;
    document.querySelectorAll('.telegram-eagle-control').forEach((button) => {
      if (button.dataset.telegramEagleKey !== message.key) return;
      if (message.state === 'saved') { button.textContent = '已保存'; button.title = '已保存'; button.disabled = true; }
      if (message.state === 'failed') { button.textContent = /限制保存|未启动下载/.test(message.error || '') ? '不可保存' : '重试'; button.title = message.error || '保存到 Eagle 失败，点击重试'; button.disabled = false; }
    });
  });
}
})();
