import { ensurePushSubscription } from './push'

export function requestNotificationPermission() {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') void ensurePushSubscription()
    })
  } else if (Notification.permission === 'granted') {
    void ensurePushSubscription()
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
