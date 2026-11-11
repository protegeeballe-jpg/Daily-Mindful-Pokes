const dialog = document.getElementById('settings-modal');
const openButton = document.getElementById('settings-open-button');
const closeButton = document.getElementById('settings-close-button');

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
