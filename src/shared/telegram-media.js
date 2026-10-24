const TELEGRAM_KINDS = ['image', 'video'];

export function telegramMediaKey({ peerId, messageId, kind } = {}) {
  if (!peerId || !messageId || !TELEGRAM_KINDS.includes(kind)) {
    throw new Error('Telegram 媒体标识无效');
  }
  return `telegram:${peerId}:${messageId}:${kind}`;
}

export function telegramDownloadFilename({ messageId, extension } = {}, requestId) {
  const outputExtension = extension === 'mp4' ? 'mp4' : 'jpg';
  return `TelegramEagle_${requestId}_${messageId}.${outputExtension}`;
}

export function telegramEagleItem(record, localPath) {
  const { peerId, messageId, kind, filename, chatName, caption } = record || {};
  const item = {
    key: telegramMediaKey({ peerId, messageId, kind }),
    kind,
    localPath,
    filename,
    tags: ['Telegram', kind === 'video' ? '视频' : '图片', chatName].filter(Boolean),
    annotation: `Telegram 消息 ID：${messageId}${caption ? `\n${caption}` : ''}`,
  };

  const website = record?.messageUrl || record?.publicUrl || record?.website;
  if (website) item.website = website;
  return item;
}
