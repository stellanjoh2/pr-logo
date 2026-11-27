/**
 * Equal-width row of panel buttons. Variants: 'primary' (accent fill), 'secondary', 'ghost'.
 */
export function createActionRow(actions) {
  const row = document.createElement('div');
  row.className = 'polyrig-action-row';
  const buttons = actions.map(({ label, title, variant = 'secondary', onClick }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `polyrig-btn polyrig-btn--${variant}`;
    button.textContent = label;
    if (title) button.title = title;
    button.addEventListener('click', onClick);
    row.appendChild(button);
    return button;
  });
  return { row, buttons };
}

/** Marks a Tweakpane button as the section's primary action. */
export function markPrimary(button) {
  button.element.classList.add('polyrig-tp-primary');
  return button;
}

export function confirmReset() {
  return window.confirm('Reset all settings to their defaults?');
}
