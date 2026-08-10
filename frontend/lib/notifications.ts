export function requestNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function notify(title: string, body: string, onClick?: () => void) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.hidden) {
    const n = new Notification(title, {
      body,
      icon: '/icons/icon.svg',
      tag: 'cryptmessenger',
      silent: false,
    })
    if (onClick) {
      n.onclick = () => { window.focus(); n.close(); onClick() }
    }
  }
}
