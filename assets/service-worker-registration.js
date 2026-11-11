/*
 * Register the app's root service worker.
 *
 * Resolve paths from this module so the app works both at the GitHub Pages
 * project path and if it is later hosted at a domain root.
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
    const appScopeUrl = new URL('../', import.meta.url);
    const serviceWorkerUrl = new URL('sw.js', appScopeUrl);

    const registerServiceWorker = () => {
        navigator.serviceWorker.register(serviceWorkerUrl.href, {
            scope: appScopeUrl.pathname
        }).catch((error) => {
            // Offline support is an enhancement; a registration failure must
            // not prevent the online app from opening.
            console.warn('[Faith & Focus] Offline support could not be enabled.', error);
        });
    };

    if (document.readyState === 'complete') {
        registerServiceWorker();
    } else {
        window.addEventListener('load', registerServiceWorker, { once: true });
    }
}
