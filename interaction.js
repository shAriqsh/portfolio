/**
 * Declarative Interaction & Clipboard Adapter Module
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PortfolioInteraction = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Resilient clipboard write function.
     * Attempts modern navigator.clipboard.writeText, falling back to document.execCommand('copy').
     * @param {string} text - The text to copy.
     * @param {Object} [options] - Injectable environment adapters.
     * @param {Object} [options.clipboard] - Navigator clipboard API.
     * @param {Document} [options.document] - Document context.
     * @returns {Promise<boolean>} Resolves to true on success, false on failure.
     */
    async function copyText(text, options = {}) {
        const clipboard = options.clipboard !== undefined
            ? options.clipboard
            : (typeof navigator !== 'undefined' ? navigator.clipboard : null);

        if (clipboard && typeof clipboard.writeText === 'function') {
            try {
                await clipboard.writeText(text);
                return true;
            } catch (err) {
                // Modern clipboard failed (e.g., permission denied), continue to fallback
            }
        }

        const doc = options.document !== undefined
            ? options.document
            : (typeof document !== 'undefined' ? document : null);

        if (!doc || typeof doc.execCommand !== 'function' || !doc.body) {
            return false;
        }

        let textarea = null;
        try {
            textarea = doc.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            if (textarea.style) {
                textarea.style.position = 'fixed';
                textarea.style.top = '-9999px';
                textarea.style.left = '-9999px';
                textarea.style.opacity = '0';
            }

            doc.body.appendChild(textarea);
            if (typeof textarea.select === 'function') {
                textarea.select();
            }
            if (typeof textarea.setSelectionRange === 'function') {
                textarea.setSelectionRange(0, 99999);
            }

            const successful = doc.execCommand('copy');
            return !!successful;
        } catch (fallbackErr) {
            return false;
        } finally {
            if (textarea && textarea.parentNode) {
                textarea.parentNode.removeChild(textarea);
            } else if (textarea && doc.body.removeChild) {
                try {
                    doc.body.removeChild(textarea);
                } catch (e) {
                    // Ignore removal error in mocks
                }
            }
        }
    }

    const COPIED_ICON_HTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';

    /**
     * Creates and attaches a declarative interaction dispatcher.
     * @param {Object} [options]
     * @param {EventTarget} [options.root] - Root element for event delegation.
     * @param {Object} [options.clipboard] - Injectable clipboard adapter.
     * @param {Document} [options.document] - Injectable document context.
     * @param {number} [options.feedbackDuration=2000] - Duration in ms before restoring original state.
     * @returns {Object} Dispatcher controller with destroy().
     */
    function createInteractionDispatcher(options = {}) {
        const root = options.root || (typeof document !== 'undefined' ? document : null);
        if (!root) {
            return { destroy: () => {} };
        }

        const duration = typeof options.feedbackDuration === 'number' ? options.feedbackDuration : 2000;
        const activeTimers = new Map();
        const originalContents = new Map();
        const toastManager = options.toastManager || createToastManager({
            document: options.document,
            defaultDuration: 3000
        });

        const handleClick = async (event) => {
            const target = event && event.target;
            const actionEl = (target && typeof target.closest === 'function')
                ? target.closest('[data-action]')
                : null;

            if (!actionEl) return;

            const action = actionEl.dataset ? actionEl.dataset.action : null;
            if (action === 'copy') {
                const text = (actionEl.dataset && actionEl.dataset.copyText) || '';
                const customToast = actionEl.dataset ? actionEl.dataset.toast : null;
                const success = await copyText(text, options);

                if (success) {
                    if (toastManager && toastManager.showToast) {
                        toastManager.showToast(customToast || 'Copied to clipboard!', 'success');
                    }

                    if (activeTimers.has(actionEl)) {
                        clearTimeout(activeTimers.get(actionEl));
                    }

                    if (!originalContents.has(actionEl)) {
                        originalContents.set(actionEl, actionEl.innerHTML);
                    }

                    actionEl.innerHTML = COPIED_ICON_HTML;
                    if (actionEl.dataset) {
                        actionEl.dataset.state = 'copied';
                    }

                    const timerId = setTimeout(() => {
                        const original = originalContents.get(actionEl);
                        if (original !== undefined) {
                            actionEl.innerHTML = original;
                            originalContents.delete(actionEl);
                        }
                        if (actionEl.dataset) {
                            delete actionEl.dataset.state;
                        }
                        activeTimers.delete(actionEl);
                    }, duration);

                    activeTimers.set(actionEl, timerId);
                } else {
                    if (toastManager && toastManager.showToast) {
                        toastManager.showToast('Failed to copy to clipboard', 'error');
                    }
                }
            }
        };

        root.addEventListener('click', handleClick);

        return {
            toastManager,
            destroy() {
                root.removeEventListener('click', handleClick);
                if (toastManager && toastManager.destroy) {
                    toastManager.destroy();
                }
                for (const [el, timerId] of activeTimers.entries()) {
                    clearTimeout(timerId);
                    const original = originalContents.get(el);
                    if (original !== undefined) {
                        el.innerHTML = original;
                    }
                    if (el.dataset) {
                        delete el.dataset.state;
                    }
                }
                activeTimers.clear();
                originalContents.clear();
            }
        };
    }

    /**
     * Creates an accessible toast notification manager.
     * Hooks to existing .notification styling with aria-live polite region and timer management.
     * @param {Object} [options]
     * @param {Document} [options.document] - Document context.
     * @param {Element} [options.container] - Container element.
     * @param {number} [options.defaultDuration=3000] - Duration in ms before auto-dismissal.
     * @returns {Object} Toast manager controller.
     */
    function createToastManager(options = {}) {
        const doc = options.document !== undefined
            ? options.document
            : (typeof document !== 'undefined' ? document : null);

        if (!doc) {
            return {
                showToast: () => null,
                dismiss: () => {},
                destroy: () => {}
            };
        }

        const defaultDuration = typeof options.defaultDuration === 'number'
            ? options.defaultDuration
            : 3000;

        let currentToast = null;
        let currentTimer = null;

        function dismiss() {
            if (currentTimer !== null) {
                clearTimeout(currentTimer);
                currentTimer = null;
            }
            if (currentToast) {
                if (currentToast.classList && currentToast.classList.remove) {
                    currentToast.classList.remove('notification--visible');
                }
                const toastToRemove = currentToast;
                currentToast = null;
                if (toastToRemove.parentElement && toastToRemove.parentElement.removeChild) {
                    try {
                        toastToRemove.parentElement.removeChild(toastToRemove);
                    } catch (e) {
                        // ignore removal errors
                    }
                }
            }
        }

        function showToast(message, type = 'success', duration = defaultDuration) {
            dismiss();

            const toast = doc.createElement('div');
            if (toast.setAttribute) {
                toast.setAttribute('role', 'status');
                toast.setAttribute('aria-live', 'polite');
                toast.setAttribute('aria-atomic', 'true');
            }

            if (toast.classList && toast.classList.add) {
                toast.classList.add('notification');
                if (type === 'success') {
                    toast.classList.add('notification--success');
                } else if (type === 'error') {
                    toast.classList.add('notification--error');
                }
                toast.classList.add('notification--visible');
            }

            toast.innerHTML = `<div class="notification-content"><span class="notification-message">${message}</span><button type="button" class="notification-close" aria-label="Close notification">&times;</button></div>`;

            const closeBtn = toast.querySelector ? toast.querySelector('.notification-close') : null;
            if (closeBtn && closeBtn.addEventListener) {
                closeBtn.addEventListener('click', () => {
                    dismiss();
                });
            }

            const targetContainer = options.container || doc.body;
            if (targetContainer && targetContainer.appendChild) {
                targetContainer.appendChild(toast);
            }

            currentToast = toast;

            if (duration > 0) {
                currentTimer = setTimeout(() => {
                    dismiss();
                }, duration);
            }

            return toast;
        }

        return {
            showToast,
            dismiss,
            destroy() {
                dismiss();
            }
        };
    }

    function initInteractionDispatcher(options = {}) {
        return createInteractionDispatcher(options);
    }

    // Auto-initialize when loaded in browser environments
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        const autoInit = () => {
            if (!window.__portfolioInteractionInstance) {
                window.__portfolioInteractionInstance = createInteractionDispatcher({ root: document });
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', autoInit);
        } else {
            autoInit();
        }
    }

    return {
        copyText,
        createInteractionDispatcher,
        initInteractionDispatcher,
        createToastManager
    };
}));
