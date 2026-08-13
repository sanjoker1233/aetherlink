'use client'

// Minimal dependency-free in-app toast. Used as a visible fallback when the
// browser Notification API is unavailable, denied, or the tab is in the
// foreground (notify() only fires OS notifications when document.hidden).
// Surfacing contact requests visibly even in the foreground is the whole point
// — otherwise a manual tester staring at the recipient tab sees nothing.

let container: HTMLDivElement | null = null

function getContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  if (!container) {
    container = document.createElement('div')
    container.style.position = 'fixed'
    container.style.top = '1rem'
    container.style.right = '1rem'
    container.style.zIndex = '9999'
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.gap = '0.5rem'
    container.style.maxWidth = 'min(22rem, calc(100vw - 2rem))'
    container.style.pointerEvents = 'none'
    document.body.appendChild(container)
  }
  return container
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return ch
    }
  })
}

export function showToast(title: string, body: string, onClick?: () => void, durationMs = 6000) {
  const c = getContainer()
  if (!c) return
  const el = document.createElement('div')
  el.style.cssText =
    'pointer-events:auto;background:rgba(20,20,30,0.95);color:#fff;' +
    'border:1px solid rgba(245,230,211,0.2);border-radius:0.75rem;' +
    'padding:0.75rem 1rem;box-shadow:0 8px 24px rgba(0,0,0,0.4);' +
    'cursor:pointer;font:14px/1.4 system-ui,sans-serif;backdrop-filter:blur(8px);' +
    'animation:cm-toast-in 0.18s ease-out'
  el.innerHTML =
    `<div style="font-weight:600">${escapeHtml(title)}</div>` +
    `<div style="opacity:0.8;margin-top:2px">${escapeHtml(body)}</div>`
  const close = () => el.remove()
  el.onclick = () => {
    try { onClick?.() } finally { close() }
  }
  c.appendChild(el)
  window.setTimeout(close, durationMs)
}

// Inject a tiny keyframe so the toast slides in. Guarded so it only runs once.
if (typeof document !== 'undefined' && !document.getElementById('cm-toast-style')) {
  const style = document.createElement('style')
  style.id = 'cm-toast-style'
  style.textContent = '@keyframes cm-toast-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:none}}'
  document.head.appendChild(style)
}
