(() => {
  let enabled = true;
  let scanning = false;
  const cache = new Map();

  function collectItems() {
    const root = document.querySelector('[role="main"]') || document.body;
    const items = [];
    const seen = new Set();
    for (const el of root.querySelectorAll('[role="row"], [data-id]')) {
      const row = el.closest('[role="row"]') || el;
      const id = row.getAttribute('data-id') || row.querySelector('[data-id]')?.getAttribute('data-id') || '';
      const link = row.querySelector('a[href*="drive.google.com"],a[href*="docs.google.com"]');
      const href = link?.href || (id ? 'https://drive.google.com/open?id=' + encodeURIComponent(id) : '');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const name = (row.innerText || row.getAttribute('aria-label') || 'פריט ללא שם').trim().split('\n')[0];
      if (name) items.push({row,href,name});
    }
    return items;
  }

  function mark(row, state) {
    row.classList.remove('dnf-blocked','dnf-unknown');
    if (state === 'blocked') row.classList.add('dnf-blocked');
    let badge = row.querySelector(':scope > .dnf-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'dnf-badge';
      row.appendChild(badge);
    }
    badge.textContent = state === 'blocked' ? 'חסום בנטפרי' : 'לא זוהתה חסימה';
  }

  function testUrl(url) {
    return new Promise(resolve => {
      let tabId = null, done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
        resolve(value);
      };
      const listener = (id, change) => {
        if (id !== tabId) return;
        const current = change.url || '';
        if (current.includes('netfree.link/block')) finish('blocked');
      };
      chrome.tabs.onUpdated.addListener(listener);
      const timer = setTimeout(() => finish('unknown'), 9000);
      chrome.tabs.create({url,active:false}).then(tab => { tabId = tab.id; })
        .catch(() => finish('unknown'));
      // אין לסמן כפתוח רק מפני שלא זוהתה חסימה.
      setTimeout(() => finish('unknown'), 5000);
    });
  }

  async function scan() {
    if (!enabled || scanning) return;
    scanning = true;
    const items = collectItems().slice(0,20);
    for (const item of items) {
      if (!enabled) break;
      if (cache.has(item.href)) { mark(item.row, cache.get(item.href)); continue; }
      mark(item.row, 'unknown');
      const result = await testUrl(item.href);
      cache.set(item.href,result);
      mark(item.row,result);
      await new Promise(r => setTimeout(r,300));
    }
    scanning = false;
  }

  chrome.storage.sync.get({dnfEnabled:true}, v => {
    enabled = v.dnfEnabled;
    if (enabled) scan();
  });
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'sync' || !changes.dnfEnabled) return;
    enabled = changes.dnfEnabled.newValue;
    if (!enabled) {
      document.querySelectorAll('.dnf-badge').forEach(x => x.remove());
      document.querySelectorAll('.dnf-blocked').forEach(x => x.classList.remove('dnf-blocked'));
    } else scan();
  });
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'DNF_RESCAN') { cache.clear(); scan(); }
  });
  let debounce;
  new MutationObserver(() => {
    if (enabled && !scanning) { clearTimeout(debounce); debounce = setTimeout(scan,1200); }
  }).observe(document.body,{childList:true,subtree:true});
})();