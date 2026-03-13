(function () {
  var STORAGE_KEY = 'webtoondrops_bookmarks';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function save(ids) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  function markButtons() {
    var bookmarks = new Set(load());
    document.querySelectorAll('.star-btn[data-id]').forEach(function (btn) {
      var isBookmarked = bookmarks.has(btn.dataset.id);
      btn.classList.toggle('bookmarked', isBookmarked);
      btn.setAttribute('aria-pressed', String(isBookmarked));
      btn.title = isBookmarked ? 'Remove from My Schedule' : 'Add to My Schedule';
    });
  }

  function showToast(message) {
    var toast = document.getElementById('bookmark-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bookmark-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);

      var style = document.createElement('style');
      style.textContent = [
        '#bookmark-toast {',
        '  position: fixed;',
        '  bottom: 24px;',
        '  left: 50%;',
        '  transform: translateX(-50%) translateY(80px);',
        '  background: var(--surface, #1e1e2e);',
        '  color: var(--text, #fff);',
        '  border: 1px solid var(--border, #333);',
        '  border-radius: 8px;',
        '  padding: 10px 20px;',
        '  font-family: "Space Grotesk", sans-serif;',
        '  font-size: 14px;',
        '  font-weight: 600;',
        '  z-index: 9999;',
        '  opacity: 0;',
        '  transition: opacity 0.2s, transform 0.2s;',
        '  white-space: nowrap;',
        '  pointer-events: none;',
        '}',
        '#bookmark-toast.visible {',
        '  opacity: 1;',
        '  transform: translateX(-50%) translateY(0);',
        '}',
      ].join('\n');
      document.head.appendChild(style);
    }

    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toast.classList.remove('visible');
    }, 2500);
  }

  var StarBookmark = {
    toggle: function (btn) {
      var id = btn.dataset.id;
      var title = btn.dataset.title || id;
      var ids = load();
      var idx = ids.indexOf(id);
      if (idx === -1) {
        ids.push(id);
        save(ids);
        btn.classList.add('bookmarked');
        btn.setAttribute('aria-pressed', 'true');
        btn.title = 'Remove from My Schedule';
        showToast('\u2605 ' + title + ' added to My Schedule');
      } else {
        ids.splice(idx, 1);
        save(ids);
        btn.classList.remove('bookmarked');
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Add to My Schedule';
        showToast(title + ' removed from My Schedule');
      }
    },
    load: load,
    markButtons: markButtons,
  };

  window.StarBookmark = StarBookmark;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markButtons);
  } else {
    markButtons();
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.star-btn[data-id]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    StarBookmark.toggle(btn);
  });

  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) markButtons();
  });
})();
