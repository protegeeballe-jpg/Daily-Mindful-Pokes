import { testVaultConnection } from './vault-sync.js';

const dialog = document.getElementById('settings-modal');
const openButton = document.getElementById('settings-open-button');
const closeButton = document.getElementById('settings-close-button');

const testSyncButton = document.getElementById('vault-test-sync-button');
if (testSyncButton) {
    testSyncButton.addEventListener('click', async () => {
        if (testSyncButton.disabled) return;
        testSyncButton.disabled = true;
        const originalText = testSyncButton.textContent;
        testSyncButton.textContent = 'Testing cloud…';
        try {
            const result = await testVaultConnection();
            const pending = result.pendingUploads.length
                ? '\\nLocal dates still queued or in conflict: ' + result.pendingUploads.join(', ')
                : '\\nNo local uploads are pending.';
            window.alert(
                'Cloudflare connection test completed.\\n\\n'
                + 'Vault ID: ' + result.vaultId + '\\n'
                + 'Shared index key: ' + result.indexKey + '\\n'
                + 'Remote dates found: ' + result.remoteDateCount
                + pending
                + '\\n\\nSee Developer Tools → Console for request details.'
            );
        } catch (error) {
            console.error('[Vault Sync Test] Connection test failed:', error);
            window.alert('Cloudflare connection test failed.\\n\\n' + (error?.message || 'Unknown error') + '\\n\\nSee Developer Tools → Console for details.');
        } finally {
            testSyncButton.disabled = false;
            testSyncButton.textContent = originalText;
        }
    });
}

if (dialog && openButton && closeButton && typeof dialog.showModal === 'function') {
    openButton.addEventListener('click', () => {
        if (dialog.open) return;
        dialog.showModal();
        openButton.setAttribute('aria-expanded', 'true');
        closeButton.focus();
    });

    closeButton.addEventListener('click', () => {
        if (dialog.open) dialog.close();
    });

    dialog.addEventListener('click', event => {
        // A click whose target is the dialog itself came from the backdrop.
        if (event.target === dialog) dialog.close();
    });

    dialog.addEventListener('close', () => {
        openButton.setAttribute('aria-expanded', 'false');
        openButton.focus({ preventScroll: true });
    });
}
