function safePathPart(value) {
  return String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'unknown';
}

function safeTitle(value) {
  if (!String(value ?? '').trim()) return '';
  return safePathPart(value).replace(/\s+/g, ' ').slice(0, 40).trim();
}

export function originalImageUrl(value) {
  const url = new URL(value);
  url.searchParams.set('name', 'orig');
  return url.toString();
}

export function highestBitrateMp4(variants = []) {
  const best = variants
    .filter((variant) => variant?.content_type === 'video/mp4' && Number.isFinite(variant.bitrate))
    .sort((a, b) => b.bitrate - a.bitrate)[0];
  return best ? { url: best.url, bitrate: best.bitrate } : null;
}

export function mediaKey(tweetId, mediaIndex, url) {
  return `${tweetId}:${mediaIndex}:${url}`;
}

export function downloadFilename(username, createdAt, mediaIndex, extension, collisionIndex = 0, tweetText = '') {
  const date = new Date(createdAt);
  const parts = [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')];
  const suffix = collisionIndex ? `_${String(collisionIndex).padStart(2, '0')}` : '';
  const title = safeTitle(tweetText);
  return `${safePathPart(username)}/${parts.join('-')}_${String(mediaIndex).padStart(2, '0')}${suffix}${title ? `_${title}` : ''}.${safePathPart(extension)}`;
}
