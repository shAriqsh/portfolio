const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { copyText } = require('../interaction.js');

describe('Clipboard Adapter', () => {
    it('successfully copies text using the asynchronous clipboard API when available', async () => {
        let copiedText = '';
        const mockClipboard = {
            writeText: async (text) => {
                copiedText = text;
                return true;
            }
        };

        const result = await copyText('test@example.com', { clipboard: mockClipboard });
        assert.equal(result, true);
        assert.equal(copiedText, 'test@example.com');
    });

    it('falls back to legacy copy mechanism when modern clipboard writeText rejects', async () => {
        let execCommandCalled = null;
        const mockClipboard = {
            writeText: async () => {
                throw new Error('NotAllowedError: Permission denied');
            }
        };
        const mockDoc = {
            execCommand: (command) => {
                execCommandCalled = command;
                return true;
            },
            body: {
                appendChild: () => {},
                removeChild: () => {}
            },
            createElement: () => ({
                style: {},
                setAttribute: () => {},
                select: () => {},
                setSelectionRange: () => {}
            })
        };

        const result = await copyText('fallback@example.com', {
            clipboard: mockClipboard,
            document: mockDoc
        });

        assert.equal(result, true);
        assert.equal(execCommandCalled, 'copy');
    });

    it('falls back to legacy copy mechanism when clipboard API is unavailable', async () => {
        let execCommandCalled = null;
        const mockDoc = {
            execCommand: (command) => {
                execCommandCalled = command;
                return true;
            },
            body: {
                appendChild: () => {},
                removeChild: () => {}
            },
            createElement: () => ({
                style: {},
                setAttribute: () => {},
                select: () => {},
                setSelectionRange: () => {}
            })
        };

        const result = await copyText('noapi@example.com', {
            clipboard: null,
            document: mockDoc
        });

        assert.equal(result, true);
        assert.equal(execCommandCalled, 'copy');
    });

    it('returns false and does not throw when both clipboard and fallback fail', async () => {
        const mockClipboard = {
            writeText: async () => {
                throw new Error('Denied');
            }
        };
        const mockDoc = {
            execCommand: () => {
                throw new Error('execCommand disabled');
            },
            body: {
                appendChild: () => {},
                removeChild: () => {}
            },
            createElement: () => ({
                style: {},
                setAttribute: () => {},
                select: () => {},
                setSelectionRange: () => {}
            })
        };

        const result = await copyText('fail@example.com', {
            clipboard: mockClipboard,
            document: mockDoc
        });

        assert.equal(result, false);
    });
});

describe('Interaction Dispatcher', () => {
    function createMockElement(tagName = 'div', attributes = {}) {
        const listeners = {};
        const element = {
            tagName,
            dataset: { ...attributes.dataset },
            innerHTML: attributes.innerHTML || '',
            parentElement: null,
            listeners,
            addEventListener(event, fn) {
                listeners[event] = listeners[event] || [];
                listeners[event].push(fn);
            },
            removeEventListener(event, fn) {
                if (listeners[event]) {
                    listeners[event] = listeners[event].filter(cb => cb !== fn);
                }
            },
            closest(selector) {
                if (selector === '[data-action]' && element.dataset.action) {
                    return element;
                }
                return null;
            },
            async dispatchEvent(event) {
                if (!event.target) {
                    event.target = element;
                }
                if (listeners[event.type]) {
                    for (const cb of listeners[event.type]) {
                        await cb(event);
                    }
                }
            }
        };
        return element;
    }

    it('delegates click on [data-action="copy"] and executes copy operation', async () => {
        const { createInteractionDispatcher } = require('../interaction.js');
        const root = createMockElement('div');
        const button = createMockElement('button', {
            dataset: { action: 'copy', copyText: 'contact@example.com' },
            innerHTML: 'Copy Email'
        });

        let copiedText = '';
        const mockClipboard = {
            writeText: async (text) => {
                copiedText = text;
                return true;
            }
        };

        const dispatcher = createInteractionDispatcher({
            root,
            clipboard: mockClipboard
        });

        // Click the button inside root
        const clickEvent = { type: 'click', target: button };
        await root.dispatchEvent(clickEvent);

        assert.equal(copiedText, 'contact@example.com');
        dispatcher.destroy();
    });

    it('displays copied feedback and restores original content after duration', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const { createInteractionDispatcher } = require('../interaction.js');
        const root = createMockElement('div');
        const originalContent = '<span class="icon"></span>Copy Email';
        const button = createMockElement('button', {
            dataset: { action: 'copy', copyText: 'contact@example.com' },
            innerHTML: originalContent
        });

        const mockClipboard = {
            writeText: async () => true
        };

        const dispatcher = createInteractionDispatcher({
            root,
            clipboard: mockClipboard,
            feedbackDuration: 2000
        });

        const clickEvent = { type: 'click', target: button };
        await root.dispatchEvent(clickEvent);

        assert.match(button.innerHTML, /Copied!/);
        assert.notEqual(button.innerHTML, originalContent);

        // Fast-forward 2000ms
        t.mock.timers.tick(2000);

        assert.equal(button.innerHTML, originalContent);
        dispatcher.destroy();
    });

    it('prevents timer race conditions and stuck visual states on successive rapid clicks', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const { createInteractionDispatcher } = require('../interaction.js');
        const root = createMockElement('div');
        const originalContent = '<span class="icon"></span>Copy Email';
        const button = createMockElement('button', {
            dataset: { action: 'copy', copyText: 'rapid@example.com' },
            innerHTML: originalContent
        });

        const mockClipboard = {
            writeText: async () => true
        };

        const dispatcher = createInteractionDispatcher({
            root,
            clipboard: mockClipboard,
            feedbackDuration: 2000
        });

        // 1st click at t=0
        await root.dispatchEvent({ type: 'click', target: button });
        assert.match(button.innerHTML, /Copied!/);

        // Advance 1000ms
        t.mock.timers.tick(1000);
        assert.match(button.innerHTML, /Copied!/);

        // 2nd click at t=1000ms
        await root.dispatchEvent({ type: 'click', target: button });
        assert.match(button.innerHTML, /Copied!/);

        // Advance another 1000ms (t=2000ms total, 1000ms since 2nd click)
        t.mock.timers.tick(1000);
        // It must NOT have restored early; it should still be "Copied!"
        assert.match(button.innerHTML, /Copied!/);

        // Advance remaining 1000ms (t=3000ms total, 2000ms since 2nd click)
        t.mock.timers.tick(1000);
        // Now it must be restored to original
        assert.equal(button.innerHTML, originalContent);
        assert.equal(button.dataset.state, undefined);

        dispatcher.destroy();
    });

    it('handles clicks on nested children inside [data-action="copy"]', async () => {
        const { createInteractionDispatcher } = require('../interaction.js');
        const root = createMockElement('div');
        const button = createMockElement('button', {
            dataset: { action: 'copy', copyText: 'nested@example.com' },
            innerHTML: '<svg class="icon"><path></path></svg><span>Copy</span>'
        });
        const svgChild = {
            tagName: 'svg',
            parentElement: button,
            closest(selector) {
                if (selector === '[data-action]') return button;
                return null;
            }
        };

        let copied = '';
        const dispatcher = createInteractionDispatcher({
            root,
            clipboard: {
                writeText: async (t) => { copied = t; return true; }
            }
        });

        await root.dispatchEvent({ type: 'click', target: svgChild });
        assert.equal(copied, 'nested@example.com');
        dispatcher.destroy();
    });

    it('exposes initInteractionDispatcher that attaches to root and returns controller', async () => {
        const { initInteractionDispatcher } = require('../interaction.js');
        const root = createMockElement('div');
        const controller = initInteractionDispatcher({ root });
        assert.equal(typeof controller.destroy, 'function');
        controller.destroy();
    });
});

describe('Toast Notification Manager', () => {
    function createMockDOM() {
        function createNode(tagName = 'div') {
            const classListSet = new Set();
            const attrs = {};
            const children = [];
            const synthMap = {};
            const listeners = {};

            const node = {
                tagName,
                innerHTML: '',
                parentElement: null,
                style: {},
                classList: {
                    add: (...cls) => cls.forEach(c => classListSet.add(c)),
                    remove: (...cls) => cls.forEach(c => classListSet.delete(c)),
                    contains: (c) => classListSet.has(c),
                    toggle: (c, force) => {
                        if (force) classListSet.add(c);
                        else classListSet.delete(c);
                        return classListSet.has(c);
                    }
                },
                setAttribute(name, val) {
                    attrs[name] = String(val);
                },
                getAttribute(name) {
                    return attrs[name] || null;
                },
                removeAttribute(name) {
                    delete attrs[name];
                },
                appendChild(child) {
                    child.parentElement = node;
                    children.push(child);
                    return child;
                },
                removeChild(child) {
                    const idx = children.indexOf(child);
                    if (idx !== -1) {
                        children.splice(idx, 1);
                        child.parentElement = null;
                    }
                    return child;
                },
                querySelector(selector) {
                    if (selector.startsWith('.')) {
                        const targetClass = selector.slice(1);
                        for (const child of children) {
                            if (child.classList && child.classList.contains(targetClass)) return child;
                            if (child.querySelector) {
                                const found = child.querySelector(selector);
                                if (found) return found;
                            }
                        }
                        if (node.innerHTML && node.innerHTML.includes(targetClass)) {
                            if (!synthMap[targetClass]) {
                                const synth = createNode('button');
                                synth.classList.add(targetClass);
                                synth.parentElement = node;
                                synthMap[targetClass] = synth;
                            }
                            return synthMap[targetClass];
                        }
                    }
                    return null;
                },
                addEventListener(event, fn) {
                    listeners[event] = listeners[event] || [];
                    listeners[event].push(fn);
                },
                removeEventListener(event, fn) {
                    if (listeners[event]) {
                        listeners[event] = listeners[event].filter(cb => cb !== fn);
                    }
                },
                async dispatchEvent(event) {
                    if (!event.target) event.target = node;
                    if (listeners[event.type]) {
                        for (const cb of listeners[event.type]) {
                            await cb(event);
                        }
                    }
                },
                get children() {
                    return [...children];
                }
            };
            return node;
        }

        const body = createNode('body');
        const doc = {
            body,
            createElement: (tag) => createNode(tag),
            querySelector: (sel) => body.querySelector(sel)
        };
        return { doc, body };
    }

    it('announces message with aria-live polite region and applies visible styles', () => {
        const { createToastManager } = require('../interaction.js');
        const { doc, body } = createMockDOM();

        const toastManager = createToastManager({ document: doc });
        const toast = toastManager.showToast('Copied to clipboard!', 'success');

        assert.ok(toast);
        assert.equal(toast.getAttribute('role'), 'status');
        assert.equal(toast.getAttribute('aria-live'), 'polite');
        assert.equal(toast.getAttribute('aria-atomic'), 'true');
        assert.ok(toast.classList.contains('notification'));
        assert.ok(toast.classList.contains('notification--success'));
        assert.ok(toast.classList.contains('notification--visible'));
        assert.ok(toast.innerHTML.includes('Copied to clipboard!'));

        toastManager.destroy();
    });

    it('automatically dismisses after duration and prevents timer race conditions on rapid successive toasts', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const { createToastManager } = require('../interaction.js');
        const { doc, body } = createMockDOM();

        const toastManager = createToastManager({ document: doc, defaultDuration: 2000 });

        // Trigger first toast
        const toast1 = toastManager.showToast('First notice', 'info');
        assert.ok(toast1.classList.contains('notification--visible'));

        // Fast forward 1000ms
        t.mock.timers.tick(1000);

        // Rapid successive toast overrides the previous timer cleanly
        const toast2 = toastManager.showToast('Second notice', 'success');
        assert.ok(toast2.innerHTML.includes('Second notice'));

        // Advance 1500ms (t=2500ms total, 1500ms since 2nd toast) -> still visible
        t.mock.timers.tick(1500);
        assert.ok(toast2.classList.contains('notification--visible'));

        // Advance remaining 500ms (t=3000ms total, 2000ms since 2nd toast) -> dismissed
        t.mock.timers.tick(500);
        assert.equal(toast2.classList.contains('notification--visible'), false);

        toastManager.destroy();
    });

    it('dismisses immediately when user clicks the notification-close button', async () => {
        const { createToastManager } = require('../interaction.js');
        const { doc } = createMockDOM();

        const toastManager = createToastManager({ document: doc });
        const toast = toastManager.showToast('Will be closed manually', 'info');

        assert.ok(toast.classList.contains('notification--visible'));

        const closeBtn = toast.querySelector('.notification-close');
        assert.ok(closeBtn);

        await closeBtn.dispatchEvent({ type: 'click' });
        assert.equal(toast.classList.contains('notification--visible'), false);

        toastManager.destroy();
    });

    it('cleans up active timers and DOM elements on destroy', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const { createToastManager } = require('../interaction.js');
        const { doc, body } = createMockDOM();

        const toastManager = createToastManager({ document: doc });
        toastManager.showToast('Temporary toast', 'success');

        assert.equal(body.children.length, 1);

        toastManager.destroy();

        // Elements removed from DOM
        assert.equal(body.children.length, 0);
    });
});

describe('Dispatcher & Toast Integration', () => {
    function createMockDOM() {
        function createNode(tagName = 'div', attributes = {}) {
            const classListSet = new Set();
            const attrs = {};
            const children = [];
            const synthMap = {};
            const listeners = {};

            const node = {
                tagName,
                dataset: { ...attributes.dataset },
                innerHTML: attributes.innerHTML || '',
                parentElement: null,
                style: {},
                classList: {
                    add: (...cls) => cls.forEach(c => classListSet.add(c)),
                    remove: (...cls) => cls.forEach(c => classListSet.delete(c)),
                    contains: (c) => classListSet.has(c),
                    toggle: (c, force) => {
                        if (force) classListSet.add(c);
                        else classListSet.delete(c);
                        return classListSet.has(c);
                    }
                },
                setAttribute(name, val) {
                    attrs[name] = String(val);
                },
                getAttribute(name) {
                    return attrs[name] || null;
                },
                removeAttribute(name) {
                    delete attrs[name];
                },
                appendChild(child) {
                    child.parentElement = node;
                    children.push(child);
                    return child;
                },
                removeChild(child) {
                    const idx = children.indexOf(child);
                    if (idx !== -1) {
                        children.splice(idx, 1);
                        child.parentElement = null;
                    }
                    return child;
                },
                closest(selector) {
                    if (selector === '[data-action]' && node.dataset && node.dataset.action) {
                        return node;
                    }
                    return null;
                },
                querySelector(selector) {
                    if (selector.startsWith('.')) {
                        const targetClass = selector.slice(1);
                        for (const child of children) {
                            if (child.classList && child.classList.contains(targetClass)) return child;
                            if (child.querySelector) {
                                const found = child.querySelector(selector);
                                if (found) return found;
                            }
                        }
                        if (node.innerHTML && node.innerHTML.includes(targetClass)) {
                            if (!synthMap[targetClass]) {
                                const synth = createNode('button');
                                synth.classList.add(targetClass);
                                synth.parentElement = node;
                                synthMap[targetClass] = synth;
                            }
                            return synthMap[targetClass];
                        }
                    }
                    return null;
                },
                addEventListener(event, fn) {
                    listeners[event] = listeners[event] || [];
                    listeners[event].push(fn);
                },
                removeEventListener(event, fn) {
                    if (listeners[event]) {
                        listeners[event] = listeners[event].filter(cb => cb !== fn);
                    }
                },
                async dispatchEvent(event) {
                    if (!event.target) event.target = node;
                    if (listeners[event.type]) {
                        for (const cb of listeners[event.type]) {
                            await cb(event);
                        }
                    }
                },
                get children() {
                    return [...children];
                }
            };
            return node;
        }

        const body = createNode('body');
        const doc = {
            body,
            createElement: (tag) => createNode(tag),
            querySelector: (sel) => body.querySelector(sel)
        };
        return { doc, body, createNode };
    }

    it('triggers accessible toast notification on successful copy action', async () => {
        const { createInteractionDispatcher } = require('../interaction.js');
        const { doc, body, createNode } = createMockDOM();

        const root = createNode('div');
        const button = createNode('button', {
            dataset: { action: 'copy', copyText: 'success@example.com' },
            innerHTML: 'Copy Email'
        });

        const dispatcher = createInteractionDispatcher({
            root,
            document: doc,
            clipboard: {
                writeText: async () => true
            }
        });

        await root.dispatchEvent({ type: 'click', target: button });

        // Toast element added to body
        assert.equal(body.children.length, 1);
        const toast = body.children[0];
        assert.ok(toast.classList.contains('notification--success'));
        assert.ok(toast.classList.contains('notification--visible'));
        assert.equal(toast.getAttribute('role'), 'status');
        assert.equal(toast.getAttribute('aria-live'), 'polite');
        assert.ok(toast.innerHTML.includes('Copied to clipboard!'));

        dispatcher.destroy();
    });

    it('triggers error toast notification when copy operation fails', async () => {
        const { createInteractionDispatcher } = require('../interaction.js');
        const { doc, body, createNode } = createMockDOM();

        const root = createNode('div');
        const button = createNode('button', {
            dataset: { action: 'copy', copyText: 'fail@example.com' },
            innerHTML: 'Copy Email'
        });

        const dispatcher = createInteractionDispatcher({
            root,
            document: doc,
            clipboard: {
                writeText: async () => { throw new Error('Permission denied'); }
            }
        });

        await root.dispatchEvent({ type: 'click', target: button });

        // Error toast triggered
        assert.equal(body.children.length, 1);
        const toast = body.children[0];
        assert.ok(toast.classList.contains('notification--error'));
        assert.ok(toast.classList.contains('notification--visible'));
        assert.ok(toast.innerHTML.includes('Failed to copy'));

        dispatcher.destroy();
    });

    it('respects custom data-toast message if provided on action element', async () => {
        const { createInteractionDispatcher } = require('../interaction.js');
        const { doc, body, createNode } = createMockDOM();

        const root = createNode('div');
        const button = createNode('button', {
            dataset: {
                action: 'copy',
                copyText: 'custom@example.com',
                toast: 'Email address copied to clipboard!'
            },
            innerHTML: 'Copy Email'
        });

        const dispatcher = createInteractionDispatcher({
            root,
            document: doc,
            clipboard: {
                writeText: async () => true
            }
        });

        await root.dispatchEvent({ type: 'click', target: button });

        assert.equal(body.children.length, 1);
        const toast = body.children[0];
        assert.ok(toast.innerHTML.includes('Email address copied to clipboard!'));

        dispatcher.destroy();
    });
});


