import { api } from './api'

// Convert a base64url VAPID public key into the Uint8Array Web Push expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const output = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i)
  return output
}

// Subscribe this browser to WebPush for the logged-in user. Called once
// notification permission is granted. Failures are non-fatal — push is a
// best-effort enhancement over the live WebSocket.
export async function ensurePushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  try {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const { publicKey } = await api.getVapidKey()
    const sub = await navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg!.pushManager.subscribe({
        userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }))
    await api.subscribePush(sub)
    return true
  } catch (e) {
    console.error('push subscribe failed', e)
    return false
  }
}
