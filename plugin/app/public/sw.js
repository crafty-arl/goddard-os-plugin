// Goddard OS service worker: shows Goddard's check-ins as push notifications and opens the app when one is tapped.
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'Goddard', body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'Goddard', { body: d.body || '', tag: d.tag, data: { url: d.url || '/' }, icon: '/icon-192.png', badge: '/icon-192.png' }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus() }
    return self.clients.openWindow(url)
  }))
})
