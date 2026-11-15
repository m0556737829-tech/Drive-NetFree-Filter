(() => {
  if (window.__dnfInstalled) return;
  window.__dnfInstalled = true;
  let enabled = true, scanning = false, stopRequested = false;
  const cache = new Map();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getRows() {
    const root = document.querySelector('[role="main"]') || document.body;
    const found = [];
    const seen = new Set();
    root.querySelectorAll('[role="row"], [data-id]').forEach(el => {
      const row = el.closest('[role="row"]') || el;
      const id = row.getAttribute('data-id') || row.querySelector('[data-id]')?.getAttribute('data-id') || '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      const a = row.querySelector('a[href*="drive.google.com"],a[href*="docs.google.com"]');
      const href = a?.href || 'https://drive.google.com/open?id=' + encodeURIComponent(id);
      const name = (row.innerText || row.getAttribute('aria-label') || 'פריט ללא שם').trim().split('\n')[0];
      const label = (row.getAttribute('aria-label') || '') + ' ' + (row.innerText || '');
      const isFolder = /folder|תיקייה|תיקיה/i.test(label);
      found.push({id, row, href, name, isFolder});
    });
    return found;
  }

  function setBadge(item, state) {
    if (!item.row?.isConnected) return;
    item.row.classList.remove('dnf-blocked','dnf-opened','dnf-unknown');
    item.row.classList.add('dnf-' + state);
    let badge = item.row.querySelector(':scope > .dnf-badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'dnf-badge'; item.row.appendChild(badge); }
    badge.textContent = state === 'blocked' ? 'נחסם' : state === 'opened' ? 'נפתח' : 'לא נבדק';
    badge.dataset.state = state;
  }

  function showProgress(done, total, counts, message) {
    let panel = document.getElementById('dnf-progress');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'dnf-progress';
      panel.innerHTML = '<b>סריקת נטפרי</b><div class="dnf-progress-text"></div><div class="dnf-progress-counts"></div><button type="button" class="dnf-stop">עצירה</button>';
      document.body.appendChild(panel);
      panel.querySelector('.dnf-stop').addEventListener('click', () => { stopRequested = true; });
    }
    panel.querySelector('.dnf-progress-text').textContent = message || ('נבדקו ' + done + ' מתוך ' + total);
    panel.querySelector('.dnf-progress-counts').textContent = 'נפתחו: ' + counts.opened + ' · נחסמו: ' + counts.blocked + ' · לא נבדקו: ' + counts.unknown;
  }

  async function gatherCurrentFolder() {
    const all = new Map();
    const scroller = [...document.querySelectorAll('*')].find(el => {
      const s = getComputedStyle(el);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 150 && el.querySelector('[role="row"]');
    });
    if (!scroller) return getRows();
    const original = scroller.scrollTop;
    let stagnant = 0, previous = -1;
    for (let i=0; i<150 && !stopRequested; i++) {
      getRows().forEach(item => all.set(item.id, item));
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(400, scroller.clientHeight * .8), scroller.scrollHeight);
      await sleep(650);
      if (scroller.scrollTop === before || scroller.scrollTop === previous) stagnant++; else stagnant = 0;
      previous = before;
      if (stagnant >= 3 || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5) {
        await sleep(700);
        getRows().forEach(item => all.set(item.id, item));
        if (stagnant >= 3) break;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5) break;
      }
    }
    scroller.scrollTop = original;
    return [...all.values()];
  }

  async function checkUrl(url) {
    let tab;
    try {
      tab = await chrome.tabs.create({url, active:false});
      const tabId = tab.id;
      const result = await new Promise(resolve => {
        let settled = false;
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(value);
        };
        const inspect = async () => {
          try {
            const [{result: page}] = await chrome.scripting.executeScript({
              target:{tabId},
              func:() => ({
                url:location.href,
                title:document.title || '',
                text:(document.body?.innerText || '').slice(0,5000),
                ready:document.readyState
              })
            });
            const u = page.url.toLowerCase(), t = page.text.toLowerCase();
            if (u.includes('netfree.link/block') || /האתר הזה עדיין לא נבדק|סוג הקובץ לא נתמך בסינון אוטומטי|אתר זה חסום|הגישה לאתר נחסמה/.test(t)) return finish('blocked');
            if ((u.includes('drive.google.com') || u.includes('docs.google.com')) &&
                page.ready === 'complete' && page.title && page.text.trim().length > 15 &&
                !/you need access|request access|אין לך גישה|נדרשת הרשאה|sign in|התחברות/.test(t)) return finish('opened');
            finish('unknown');
          } catch (_) { finish('unknown'); }
        };
        const listener = (id, info) => {
          if (id !== tabId) return;
          if ((info.url || '').includes('netfree.link/block')) finish('blocked');
          else if (info.status === 'complete') setTimeout(inspect, 700);
        };
        chrome.tabs.onUpdated.addListener(listener);
        const timeout = setTimeout(() => finish('unknown'), 15000);
        chrome.tabs.get(tabId).then(t => { if (t.status === 'complete') setTimeout(inspect,700); }).catch(() => finish('unknown'));
      });
      return result;
    } catch (_) { return 'unknown'; }
    finally { if (tab?.id != null) chrome.tabs.remove(tab.id).catch(() => {}); }
  }

  async function scan() {
    if (!enabled || scanning) return;
    scanning = true; stopRequested = false;
    const counts = {opened:0,blocked:0,unknown:0};
    try {
      const items = await gatherCurrentFolder();
      const total = items.length;
      showProgress(0,total,counts,'נמצאו ' + total + ' פריטים בתיקייה הנוכחית. מתחיל לבדוק…');
      for (let i=0; i<items.length && enabled && !stopRequested; i++) {
        const item = items[i];
        const state = cache.has(item.href) ? cache.get(item.href) : await checkUrl(item.href);
        cache.set(item.href,state);
        counts[state]++;
        setBadge(item,state);
        showProgress(i+1,total,counts,'נבדק: ' + item.name);
        await sleep(250);
      }
      showProgress(total,total,counts,stopRequested ? 'הסריקה נעצרה.' : 'הסריקה הסתיימה בתיקייה הנוכחית.');
    } finally { scanning = false; }
  }

  chrome.storage.sync.get({dnfEnabled:true}, v => { enabled=v.dnfEnabled; if(enabled) scan(); });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'sync' || !changes.dnfEnabled) return;
    enabled=changes.dnfEnabled.newValue;
    if (!enabled) {
      document.querySelectorAll('.dnf-badge').forEach(x=>x.remove());
      document.querySelectorAll('.dnf-blocked,.dnf-opened,.dnf-unknown').forEach(x=>x.classList.remove('dnf-blocked','dnf-opened','dnf-unknown'));
      document.getElementById('dnf-progress')?.remove();
    } else scan();
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'DNF_RESCAN') { cache.clear(); scan(); }
    if (msg?.type === 'DNF_STOP') stopRequested=true;
  });
  let debounce;
  new MutationObserver(() => {
    if (enabled && !scanning) { clearTimeout(debounce); debounce=setTimeout(scan,1600); }
  }).observe(document.body,{childList:true,subtree:true});
})();