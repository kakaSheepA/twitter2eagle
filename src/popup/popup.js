function summaryText(status) {
  if (status?.error) return `错误：${status.error}`;
  if (!status || status.total === undefined) return '当前没有活动任务。';
  return `已采集 ${status.total} 项；待下载 ${status.pending ?? 0}，下载中 ${status.downloading ?? 0}，完成 ${status.completed ?? 0}，失败 ${status.failed ?? 0}，无可用 MP4 ${status.unavailable ?? 0}${status.collecting ? '。正在采集，请继续手动滚动。' : '。'}`;
}

export function mountPopup({ sendMessage, getProfile }) {
  const status = document.querySelector('#status');
  const update = async (message) => { status.textContent = summaryText(await sendMessage(message)); };
  document.querySelector('#start').addEventListener('click', async () => {
    const username = await getProfile();
    if (!username) { status.textContent = '请先打开 X 用户主页。'; return; }
    await update({ type: 'START_COLLECTION', username, options: { includeReplies: document.querySelector('#replies').checked, includeReposts: document.querySelector('#reposts').checked } });
  });
  document.querySelector('#stop').addEventListener('click', () => update({ type: 'STOP_COLLECTION' }));
  document.querySelector('#download').addEventListener('click', () => update({ type: 'START_DOWNLOADS' }));
  document.querySelector('#retry').addEventListener('click', () => update({ type: 'RETRY_FAILED' }));
  update({ type: 'GET_STATUS' });
}

async function currentProfile() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url ?? '');
  if (!['x.com', 'twitter.com'].includes(url.hostname)) return null;
  const username = url.pathname.split('/').filter(Boolean)[0];
  return username && !['home', 'explore', 'search', 'settings', 'i'].includes(username) ? username : null;
}

if (typeof chrome !== 'undefined') mountPopup({ sendMessage: (message) => chrome.runtime.sendMessage(message), getProfile: currentProfile });
