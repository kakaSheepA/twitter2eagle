export function tweetSourceUrl(tweetId) {
  return `https://x.com/i/status/${encodeURIComponent(String(tweetId ?? ''))}`;
}

export function isEagleImportable(item = {}, allowReimport = false) {
  return Boolean(item.url) && item.status !== 'unavailable' && (allowReimport || item.eagleStatus !== 'imported');
}

export function eagleImportPayload(item = {}, username = '') {
  const type = item.kind === 'image' ? '图片' : '视频';
  return {
    url: item.url,
    name: String(item.filename ?? '').split('/').at(-1) || undefined,
    website: tweetSourceUrl(item.tweetId),
    tags: ['X', username, type].filter(Boolean),
    ...(item.tweetText ? { annotation: item.tweetText } : {}),
    ...(item.kind ? { kind: item.kind } : {}),
    requiresLocalImport: item.kind === 'hls'
  };
}
