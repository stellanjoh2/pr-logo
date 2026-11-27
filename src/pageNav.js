const UI_OPEN_KEY = 'polyrig-ui-open';

/** Moves the page tabs into the panel; switching pages keeps the panel open on arrival. */
export function mountPageNav(container) {
  const nav = document.getElementById('page-nav');
  if (!nav) return;
  container.appendChild(nav);
  nav.addEventListener('click', (event) => {
    if (!event.target.closest('a')) return;
    try {
      sessionStorage.setItem(UI_OPEN_KEY, '1');
    } catch {
      // Storage can be blocked (e.g. sandboxed iframes); the panel just starts hidden.
    }
  });
}

export function consumeUiOpenFlag() {
  try {
    const open = sessionStorage.getItem(UI_OPEN_KEY) === '1';
    sessionStorage.removeItem(UI_OPEN_KEY);
    return open;
  } catch {
    return false;
  }
}
