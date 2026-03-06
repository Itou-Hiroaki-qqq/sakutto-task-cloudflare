// Service Worker (メール通知のみのため、push処理は不要)
// キャッシュなし・最小限の実装

self.addEventListener('install', function() {
    self.skipWaiting();
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});
