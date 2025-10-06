(() => {
  const TOOLBAR_ID = 'upwork-filter-toolbar';
  const MODAL_OVERLAY_ID = 'upwork-filter-modal-overlay';
  const MODAL_ID = 'upwork-filter-modal';
  const DOMAIN_PREFIX = 'https://upwork.com';

  let paused = false;
  let collecting = false;
  let pauseResolver = null;

  function ensureToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;

    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;

    const collectBtn = document.createElement('button');
    collectBtn.id = 'upwork-filter-btn-collect';
    collectBtn.textContent = '采集工作';

    const pauseBtn = document.createElement('button');
    pauseBtn.id = 'upwork-filter-btn-pause';
    pauseBtn.textContent = '暂停';

    collectBtn.addEventListener('click', async () => {
      if (collecting) return;
      collecting = true;
      collectBtn.disabled = true;
      try {
        const jobs = await collectAllPagesWithPause();
        showJobsModal(jobs);
      } catch (err) {
        console.error('[UpworkFilter] 采集错误:', err);
      } finally {
        collecting = false;
        collectBtn.disabled = false;
      }
    });

    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? '恢复' : '暂停';
      if (!paused && pauseResolver) {
        pauseResolver();
        pauseResolver = null;
      }
    });

    bar.appendChild(collectBtn);
    bar.appendChild(pauseBtn);
    document.body.appendChild(bar);
  }

  async function waitIfPaused() {
    if (!paused) return;
    return new Promise((resolve) => {
      pauseResolver = resolve;
    });
  }

  // 人类化延时与随机数
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function qsAllArticles() {
    // 尽量兼容：优先 data-test 标记，其次 class
    const a = Array.from(document.querySelectorAll('article[data-test="JobTile"]'));
    const b = Array.from(document.querySelectorAll('article.job-tile'));
    // 合并去重
    const map = new Map();
    [...a, ...b].forEach(el => map.set(el, el));
    return Array.from(map.keys());
  }

  function isPaymentVerified(tile) {
    const details = tile.querySelector('div[data-test="JobTileDetails"]');
    const li = details?.querySelector('li[data-test="payment-verified"]');
    if (!li) return false;

    const badge = li.querySelector('[data-test="UpCVerifiedBadge"]');
    if (badge) {
      if (badge.classList.contains('is-verified')) return true;
      if (badge.classList.contains('is-unverified')) return false;
    }

    const text = (li.textContent || '').toLowerCase();
    if (text.includes('payment verified')) return true;
    if (text.includes('payment unverified')) return false;

    return false;
  }

  function isTotalSpentZero(tile) {
    const details = tile.querySelector('div[data-test="JobTileDetails"]');
    const liSpent = details?.querySelector('li[data-test="total-spent"]');
    if (!liSpent) return false; // 未提供该信息则不阻断采集
    const strong = liSpent.querySelector('strong');
    const text = (strong?.textContent || '').trim();
    return text === '$0';
  }

  function isBlockedLocation(tile) {
    const details = tile.querySelector('div[data-test="JobTileDetails"]');
    const liLoc = details?.querySelector('li[data-test="location"]');
    if (!liLoc) return false; // 没有位置信息则不过滤

    const spanTab = liLoc.querySelector('span[tabindex="0"]') || liLoc.querySelector('span');
    let text = (spanTab?.textContent || liLoc.textContent || '').trim();
    // 去掉辅助文案“Location”
    text = text.replace(/\bLocation\b\s*/i, '').trim();
    // 归一化空格
    text = text.replace(/\s+/g, ' ').trim();

    // 简单提取国家（可能是“USA”、“India”、“Worldwide”等）
    const country = text.split(/[•,|]/)[0].trim();
    const blocked = new Set(['india']);
    return blocked.has(country.toLowerCase());
  }

  function isRecent(tile) {
    // 发布时长过滤：仅采集 1–2 天内或数小时内发布的工作
    const el = tile.querySelector('small[data-test="job-pubilshed-date"]')
      || tile.querySelector('small[data-test="job-published-date"]')
      || tile.querySelector('small.text-light.mb-1');
    if (!el) return false;
    let text = (el.textContent || '').toLowerCase().trim();
    text = text.replace(/\s+/g, ' ');
    const m = text.match(/posted\s+(\d+)\s+([a-z]+)\s+ago/);
    if (m) {
      const num = parseInt(m[1], 10);
      const unit = m[2];
      if (unit.startsWith('hour')) return true;
      if (unit.startsWith('day') && num <= 2) return true;
      return false;
    }
    if (text.includes('hours ago') || text.includes('hour ago')) return true;
    if (text.includes('1 day ago')) return true;
    if (text.includes('2 days ago') || text.includes('2 day ago')) return true;
    return false;
  }

  async function collectJobsWithPause() {
    const tiles = qsAllArticles();
    const jobs = [];
    for (const tile of tiles) {
      // 支持暂停/恢复
      await waitIfPaused();

      // 仅采集 Payment verified
      const verified = isPaymentVerified(tile);
      if (!verified) {
        // 跳过未验证支付的工作
        await new Promise(r => setTimeout(r, 0));
        continue;
      }

      // 若 total spent 为 $0，则不采集
      const spentZero = isTotalSpentZero(tile);
      if (spentZero) {
        await new Promise(r => setTimeout(r, 0));
        continue;
      }

      // 屏蔽指定国家（例如 India）
      const blockedLoc = isBlockedLocation(tile);
      if (blockedLoc) {
        await new Promise(r => setTimeout(r, 0));
        continue;
      }

      // 发布时长过滤：仅采集 1–2 天内或数小时内发布
      const recent = isRecent(tile);
      if (!recent) {
        await new Promise(r => setTimeout(r, 0));
        continue;
      }

      const header = tile.querySelector('div.job-tile-header.d-flex.align-items-start');
      const titleLink = header?.querySelector('a.air3-link[href]')
        || tile.querySelector('a.air3-link[href][data-test*="job-tile-title-link"]');

      let href = null;
      let title = null;
      if (titleLink) {
        href = titleLink.getAttribute('href');
        title = (titleLink.textContent || '').trim();
      }

      if (href) {
        const full = new URL(href, DOMAIN_PREFIX).toString();
        jobs.push({ title, href, full, verified: true });
      }
      // 微小让步，避免长任务阻塞UI
      await new Promise(r => setTimeout(r, 0));
    }
    console.log('[UpworkFilter] 采集完成:', jobs);
    return jobs;
  }

  function getPageSignature() {
    const arts = qsAllArticles();
    if (!arts.length) return '';
    return arts
      .slice(0, 5)
      .map(a => a.getAttribute('data-test-key')
        || a.getAttribute('data-ev-job-uid')
        || a.querySelector('a.air3-link[href]')?.getAttribute('href')
        || '')
      .join('|');
  }

  function clickNextPageIfAvailable() {
    const nextBtn = document.querySelector('button[data-test="next-page"]');
    if (!nextBtn) return false;
    const ariaDisabled = nextBtn.getAttribute('aria-disabled');
    if (nextBtn.disabled || ariaDisabled === 'true') return false;
    nextBtn.click();
    return true;
  }

  // 模拟用户滚动，逐步向下滚动至页面底部附近
  async function humanScrollDown(totalMs = 2000) {
    const start = Date.now();
    const el = document.scrollingElement || document.documentElement;
    while (Date.now() - start < totalMs) {
      await waitIfPaused();
      const step = rand(150, 420); // 每次滚动像素数
      window.scrollBy(0, step);
      const nearBottom = (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 24);
      if (nearBottom) break;
      await sleep(rand(140, 280)); // 间隔时间
    }
  }

  async function waitForPageChange(prevSignature, timeoutMs = 20000) {
    const step = 350;
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await waitIfPaused();
      await sleep(step);
      const sig = getPageSignature();
      if (sig && sig !== prevSignature) return true;
    }
    return false;
  }

  async function collectAllPagesWithPause(maxPages = 50) {
    const all = [];
    const seen = new Set();
    let pages = 0;
    while (pages < maxPages) {
      await waitIfPaused();
      const sig = getPageSignature();
      if (sig && seen.has(sig)) break;
      seen.add(sig);

      const pageJobs = await collectJobsWithPause();
      all.push(...pageJobs);

      // 翻页前模拟浏览行为：向下滚动 + 延时
      await humanScrollDown(rand(1500, 2600));
      await sleep(rand(500, 1300));

      const clicked = clickNextPageIfAvailable();
      if (!clicked) break;

      // 点击后稍作等待，模拟反应时间
      await sleep(rand(300, 800));

      const changed = await waitForPageChange(sig, 20000);
      if (!changed) break;
      // 页面变化后再缓一缓，并回到顶部开始新一页采集
      await sleep(rand(800, 1600));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await sleep(rand(400, 900));
      pages++;
    }
    console.log('[UpworkFilter] 跨页采集完成:', all);
    return all;
  }

  function ensureModal() {
    if (document.getElementById(MODAL_OVERLAY_ID)) return;
    const overlay = document.createElement('div');
    overlay.id = MODAL_OVERLAY_ID;

    const modal = document.createElement('div');
    modal.id = MODAL_ID;

    const header = document.createElement('header');
    const h3 = document.createElement('h3');
    h3.textContent = 'Payment verified 可跳转的工作列表';
    const close = document.createElement('span');
    close.className = 'close';
    close.textContent = '×';
    close.title = '关闭';

    header.appendChild(h3);
    header.appendChild(close);

    const content = document.createElement('div');
    content.className = 'content';

    const counters = document.createElement('div');
    counters.id = 'upwork-filter-counters';

    const list = document.createElement('ul');
    list.id = 'upwork-filter-list';

    content.appendChild(counters);
    content.appendChild(list);
    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideModal();
    });
    close.addEventListener('click', hideModal);
  }

  function showJobsModal(jobs) {
    ensureModal();
    const overlay = document.getElementById(MODAL_OVERLAY_ID);
    const list = document.getElementById('upwork-filter-list');
    const counters = document.getElementById('upwork-filter-counters');

    list.innerHTML = '';
    counters.textContent = `共 ${jobs.length} 个Payment verified工作`;

    jobs.forEach(job => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = job.full;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = job.title || job.href;
      li.appendChild(a);
      list.appendChild(li);
    });

    overlay.style.display = 'block';
  }

  function hideModal() {
    const overlay = document.getElementById(MODAL_OVERLAY_ID);
    if (overlay) overlay.style.display = 'none';
  }

  function init() {
    ensureToolbar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();