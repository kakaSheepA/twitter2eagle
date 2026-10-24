function originalImageUrl(value) {
  const url = new URL(value);
  url.searchParams.set('name', 'orig');
  return url.toString();
}

function highestBitrateMp4(variants = []) {
  return variants.filter((variant) => variant?.content_type === 'video/mp4' && Number.isFinite(variant.bitrate))
    .sort((a, b) => b.bitrate - a.bitrate)[0] ?? null;
}

function mediaKey(tweetId, mediaIndex, url) {
  return `${tweetId}:${mediaIndex}:${url}`;
}

function extension(value) {
  try { return new URL(value).searchParams.get('format') ?? 'jpg'; } catch { return 'jpg'; }
}

function matchesMediaType(record, mediaType = 'all') {
  return mediaType === 'all' || (mediaType === 'image' ? record.kind === 'image' : record.kind === 'video' || record.kind === 'hls');
}

function collectionOptions(value = 'all') {
  return typeof value === 'string' ? { mediaType: value, includeReplies: true, includeReposts: true } : { mediaType: value?.mediaType ?? 'all', includeReplies: Boolean(value?.includeReplies), includeReposts: Boolean(value?.includeReposts) };
}

function profileNameFromPage(root = document) {
  const values = [...root.querySelectorAll('[data-testid="UserName"] span')].map((node) => node.textContent?.trim()).filter(Boolean);
  return values.find((value) => !value.startsWith('@')) ?? '';
}

function tweetTextFromTweet(tweet) {
  return tweet?.note_tweet?.note_tweet_results?.result?.text ?? tweet?.legacy?.full_text ?? '';
}

function recordsFromTweet(tweet, username, mediaType = 'all') {
  const legacy = tweet?.legacy ?? {};
  const media = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  const createdAt = new Date(legacy.created_at).toISOString();
  const tweetText = tweetTextFromTweet(tweet);
  return media.map((entry, mediaIndex) => {
    if (entry.type === 'photo') {
      const url = originalImageUrl(entry.media_url_https);
      return { key: mediaKey(tweet.rest_id, mediaIndex, url), tweetId: tweet.rest_id, mediaIndex, username, createdAt, tweetText, kind: 'image', url, extension: extension(url), status: 'pending' };
    }
    const best = highestBitrateMp4(entry.video_info?.variants);
    const hls = (entry.video_info?.variants ?? []).find((variant) => variant?.content_type === 'application/x-mpegURL');
    if (!best && hls) return { key: mediaKey(tweet.rest_id, mediaIndex, hls.url), tweetId: tweet.rest_id, mediaIndex, username, createdAt, tweetText, kind: 'hls', url: hls.url, extension: 'm3u8', status: 'pending', notice: '仅保存 HLS 播放清单，离线播放仍依赖远端分片' };
    if (!best) return { key: mediaKey(tweet.rest_id, mediaIndex, entry.media_url_https ?? `unavailable-${mediaIndex}`), tweetId: tweet.rest_id, mediaIndex, username, createdAt, tweetText, kind: 'video', status: 'unavailable', error: '该视频没有可下载的 MP4 或 HLS 播放清单版本' };
    return { key: mediaKey(tweet.rest_id, mediaIndex, best.url), tweetId: tweet.rest_id, mediaIndex, username, createdAt, tweetText, kind: 'video', url: best.url, extension: 'mp4', bitrate: best.bitrate, status: 'pending' };
  }).filter((record) => matchesMediaType(record, mediaType));
}

function articleFromAddedNode(node) {
  if (node?.nodeType !== 1) return node?.parentElement?.closest?.('article') ?? null;
  return node.closest?.('article') ?? node.querySelector?.('article') ?? null;
}

function autoScrollSettings(innerHeight) {
  return { top: Math.max(1, Math.floor(innerHeight * 0.4)), behavior: 'auto', delay: 400 };
}

function autoScrollTick(page, beforeHeight) {
  const beforeY = page.scrollY;
  page.scrollBy(autoScrollSettings(page.innerHeight));
  return { moved: page.scrollY !== beforeY, heightChanged: page.document.body.scrollHeight !== beforeHeight };
}

function shouldFinishAutoScroll(idleRounds, threshold = 10) {
  return idleRounds >= threshold;
}

function probeVideoSilently(video, delay = 800) {
  if (video.dataset.xMediaProbe || !video.paused) return Promise.resolve(false);
  video.dataset.xMediaProbe = 'true';
  const muted = video.muted;
  video.muted = true;
  return Promise.resolve(video.play()).then(() => new Promise((resolve) => setTimeout(() => {
    video.pause();
    video.muted = muted;
    resolve(true);
  }, delay))).catch(() => {
    video.muted = muted;
    return false;
  });
}

function recordsFromArticle(article, username, options = 'all', eligibilityByTweet = null) {
  const settings = collectionOptions(options);
  if (!settings.includeReposts && article.querySelector('[data-testid="socialContext"]')) return [];
  const statusLink = article.querySelector('time')?.closest('a[href*="/status/"]')?.getAttribute('href');
  const match = statusLink?.match(/\/status\/(\d+)/);
  const createdAt = article.querySelector('time[datetime]')?.getAttribute('datetime');
  const tweetText = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ?? '';
  if (!match || !createdAt) return [];
  const eligibility = eligibilityByTweet?.get(match[1]);
  if (eligibility && ((!settings.includeReplies && eligibility.isReply) || (!settings.includeReposts && eligibility.isRepost))) return [];
  const images = [...article.querySelectorAll('img[src*="twimg.com/media"]')]
    .filter((image) => {
      const linkedStatus = image.closest('a[href*="/status/"]')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1];
      return !linkedStatus || linkedStatus === match[1];
    }).map((image, mediaIndex) => {
    const url = originalImageUrl(image.src);
    return { key: mediaKey(match[1], mediaIndex, url), tweetId: match[1], mediaIndex, username, createdAt, tweetText, kind: 'image', url, extension: extension(url) };
  });
  const videos = [...article.querySelectorAll('video')].filter((video) => {
    const linkedStatus = video.closest('a[href*="/status/"]')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1];
    return !linkedStatus || linkedStatus === match[1];
  }).map((video, index) => {
    const mediaIndex = images.length + index;
    const poster = video.poster || video.getAttribute('poster') || `video-${mediaIndex}`;
    return { key: mediaKey(match[1], mediaIndex, poster), tweetId: match[1], mediaIndex, username, createdAt, tweetText, kind: 'video', status: 'pending', needsResolve: true, poster };
  });
  return [...images, ...videos].filter((record) => matchesMediaType(record, settings.mediaType));
}

function recordsFromVisibleArticles(root, username, options = 'all', eligibilityByTweet = null) {
  return [...root.querySelectorAll('article')].flatMap((article) => recordsFromArticle(article, username, options, eligibilityByTweet));
}

function visibleScanDiagnostics(root, username, options = 'all', eligibilityByTweet = null) {
  const articles = root.querySelectorAll('article').length;
  return { articles, records: recordsFromVisibleArticles(root, username, options, eligibilityByTweet).length };
}

function coalesceMediaRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => record?.key && !seen.has(record.key) && (seen.add(record.key), true));
}

function findTweets(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (value.rest_id && (value.legacy?.extended_entities?.media || value.legacy?.entities?.media)) found.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => findTweets(item, found));
    else if (child && typeof child === 'object') findTweets(child, found);
  }
  return found;
}

function isAllowed(tweet, options) {
  if (!options.includeReplies && tweet.legacy?.in_reply_to_status_id_str) return false;
  if (!options.includeReposts && tweet.legacy?.retweeted_status_result) return false;
  return true;
}

globalThis.XMediaContent = { recordsFromTweet, recordsFromArticle, recordsFromVisibleArticles, visibleScanDiagnostics, coalesceMediaRecords, findTweets, autoScrollSettings, autoScrollTick, shouldFinishAutoScroll, articleFromAddedNode, probeVideoSilently, matchesMediaType, profileNameFromPage };

if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
  if (!globalThis.__xMediaContentInstalled) {
    globalThis.__xMediaContentInstalled = true;
    let autoScrollTimer = null;
  let autoScrollPaused = false;
  let visibleRescanTimer = null;
  let pendingRecords = [];
  let pendingRecordsTimer = null;
  const eligibilityByTweet = new Map();
  const storageArea = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
  const getActiveTask = async () => {
    if (!storageArea) return null;
    try { const result = await storageArea.get('x-media-active'); return (result && result['x-media-active']) || null; } catch { return null; }
  };
  const sendDiscoveredBatch = (records) => {
    if (!records.length) return;
    pendingRecords.push(...records);
    if (pendingRecordsTimer) return;
    pendingRecordsTimer = setTimeout(() => {
      const batch = coalesceMediaRecords(pendingRecords);
      pendingRecords = [];
      pendingRecordsTimer = null;
      if (batch.length) chrome.runtime.sendMessage({ type: 'MEDIA_DISCOVERED_BATCH', records: batch });
    }, 120);
  };
  const collectArticle = async (article) => {
    const task = await getActiveTask();
    if (!task?.collecting) return;
    sendDiscoveredBatch(recordsFromArticle(article, task.username, task.options, eligibilityByTweet));
  };

  const scanArticles = (root) => {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.matches?.('article')) collectArticle(root);
    root.querySelectorAll?.('article').forEach(collectArticle);
  };

  const collectVisibleArticles = async () => {
    const task = await getActiveTask();
    if (!task?.collecting) return;
    chrome.runtime.sendMessage({ type: 'COLLECTION_LOG', message: '内容脚本已收到首屏扫描命令' });
    const diagnostic = visibleScanDiagnostics(document, task.username, task.options, eligibilityByTweet);
    chrome.runtime.sendMessage({ type: 'COLLECTION_DIAGNOSTIC', diagnostic });
    sendDiscoveredBatch(recordsFromVisibleArticles(document, task.username, task.options, eligibilityByTweet));
  };

  const scheduleVisibleRescan = () => {
    clearTimeout(visibleRescanTimer);
    visibleRescanTimer = setTimeout(collectVisibleArticles, 180);
  };

  const probeVisibleVideos = (options = 'all') => {
    if (collectionOptions(options).mediaType === 'image') return;
    document.querySelectorAll('article video').forEach((video) => {
      probeVideoSilently(video);
    });
  };

  const stopAutoScroll = () => {
    if (autoScrollTimer) clearTimeout(autoScrollTimer);
    autoScrollTimer = null;
  };

  const scheduleAutoScroll = () => {
    stopAutoScroll();
    let idleRounds = 0;
    const tick = async () => {
      const task = await getActiveTask();
      if (!task?.collecting || task.scrollMode !== 'auto' || autoScrollPaused) return;
      const settings = autoScrollSettings(window.innerHeight);
      const beforeY = window.scrollY;
      window.scrollBy(settings);
      scheduleVisibleRescan();
      idleRounds = window.scrollY === beforeY ? idleRounds + 1 : 0;
      if (shouldFinishAutoScroll(idleRounds)) {
        chrome.runtime.sendMessage({ type: 'AUTO_SCROLL_FINISHED' });
        stopAutoScroll();
        return;
      }
      autoScrollTimer = setTimeout(async () => {
        tick();
      }, settings.delay);
    };
    tick();
  };

  new MutationObserver((mutations) => mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    const article = articleFromAddedNode(node);
    if (article) collectArticle(article);
  })))
    .observe(document.documentElement, { childList: true, subtree: true });
  scanArticles(document);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'GET_PROFILE_IDENTITY') return Promise.resolve({ profileName: profileNameFromPage() });
    if (message.type === 'SCAN_VISIBLE_ARTICLES') { collectVisibleArticles().then(() => getActiveTask()).then((task) => probeVisibleVideos(task?.options)); }
    if (message.type === 'START_AUTO_SCROLL') { autoScrollPaused = false; scheduleAutoScroll(); }
    if (message.type === 'PAUSE_AUTO_SCROLL') { autoScrollPaused = true; stopAutoScroll(); }
    if (message.type === 'RESUME_AUTO_SCROLL') { autoScrollPaused = false; scheduleAutoScroll(); }
    if (message.type === 'STOP_AUTO_SCROLL') stopAutoScroll();
  });

  window.addEventListener('x-media-timeline', async (event) => {
    const tweets = findTweets(event.detail);
    for (const tweet of tweets) eligibilityByTweet.set(tweet.rest_id, { isReply: Boolean(tweet.legacy?.in_reply_to_status_id_str), isRepost: Boolean(tweet.legacy?.retweeted_status_result) });
    const task = await getActiveTask();
    if (!task?.collecting) return;
    const records = [];
    for (const tweet of tweets) {
      if (!isAllowed(tweet, task.options)) continue;
      records.push(...recordsFromTweet(tweet, task.username, task.options?.mediaType));
    }
    sendDiscoveredBatch(records);
  });
  }
}
