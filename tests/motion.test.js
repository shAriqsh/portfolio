const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createMotionCoordinator } = require('../motion.js');

function createMockWindow(initial = {}) {
    const listeners = {};
    return {
        scrollY: initial.scrollY || 0,
        scrollX: initial.scrollX || 0,
        innerWidth: initial.innerWidth || 1024,
        innerHeight: initial.innerHeight || 768,
        matchMedia: () => ({ matches: false }),
        addEventListener(event, fn) {
            listeners[event] = listeners[event] || [];
            listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (listeners[event]) {
                listeners[event] = listeners[event].filter(cb => cb !== fn);
            }
        },
        emit(event, data = {}) {
            if (listeners[event]) {
                listeners[event].forEach(cb => cb({ type: event, ...data }));
            }
        }
    };
}

function createMockFrameProvider() {
    let queued = [];
    return {
        requestFrame(cb) {
            queued.push(cb);
            return queued.length;
        },
        cancelFrame(id) {
            queued = queued.filter((_, idx) => idx + 1 !== id);
        },
        flush(timestamp = 16.6) {
            const current = [...queued];
            queued = [];
            current.forEach(cb => cb(timestamp));
        },
        get queuedCount() {
            return queued.length;
        }
    };
}

describe('Motion Coordinator - Frame Loop & Cached Metrics', () => {
    it('caches viewport metrics and batches subscriber notifications in a single frame', () => {
        const mockWin = createMockWindow({ scrollY: 0, innerWidth: 1200, innerHeight: 800 });
        const frameProvider = createMockFrameProvider();

        const coordinator = createMotionCoordinator({
            window: mockWin,
            frameProvider
        });

        let subscriber1Calls = [];
        let subscriber2Calls = [];

        coordinator.subscribeScroll((metrics) => {
            subscriber1Calls.push({ ...metrics });
        });
        coordinator.subscribeScroll((metrics) => {
            subscriber2Calls.push({ ...metrics });
        });

        // Initially no frame is queued until scroll occurs
        assert.equal(frameProvider.queuedCount, 0);

        // Simulate 3 rapid scroll events before frame fires
        mockWin.scrollY = 100;
        mockWin.emit('scroll');
        mockWin.scrollY = 150;
        mockWin.emit('scroll');
        mockWin.scrollY = 200;
        mockWin.emit('scroll');

        // Only ONE frame should be scheduled despite 3 scroll events
        assert.equal(frameProvider.queuedCount, 1);
        assert.equal(subscriber1Calls.length, 0);

        // Flush animation frame
        frameProvider.flush();

        // Both subscribers received batched metrics with latest values
        assert.equal(subscriber1Calls.length, 1);
        assert.equal(subscriber2Calls.length, 1);
        assert.equal(subscriber1Calls[0].scrollY, 200);
        assert.equal(subscriber1Calls[0].innerHeight, 800);
        assert.equal(subscriber2Calls[0].scrollY, 200);

        // Metrics are cached in coordinator
        const metrics = coordinator.getMetrics();
        assert.equal(metrics.scrollY, 200);
        assert.equal(metrics.innerHeight, 800);

        coordinator.destroy();
    });

    it('debounces resize calculations to prevent continuous layout updates', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const mockWin = createMockWindow({ innerWidth: 1024, innerHeight: 768 });
        const coordinator = createMotionCoordinator({
            window: mockWin,
            resizeDebounceMs: 150
        });

        const resizeCalls = [];
        coordinator.subscribeResize((metrics) => {
            resizeCalls.push({ ...metrics });
        });

        // Emit rapid resize events
        mockWin.innerWidth = 1000;
        mockWin.emit('resize');
        t.mock.timers.tick(50);

        mockWin.innerWidth = 900;
        mockWin.emit('resize');
        t.mock.timers.tick(50);

        mockWin.innerWidth = 800;
        mockWin.emit('resize');

        // Not yet 150ms since last event
        t.mock.timers.tick(100);
        assert.equal(resizeCalls.length, 0);

        // Advance remaining 50ms (150ms since last resize)
        t.mock.timers.tick(50);
        assert.equal(resizeCalls.length, 1);
        assert.equal(resizeCalls[0].innerWidth, 800);

        // Cached metrics reflect the updated dimensions
        assert.equal(coordinator.getMetrics().innerWidth, 800);

        coordinator.destroy();
    });

    it('evaluates reduced-motion preference once and suppresses frame loops when enabled', () => {
        const mockWin = createMockWindow({ scrollY: 0 });
        const frameProvider = createMockFrameProvider();

        const coordinator = createMotionCoordinator({
            window: mockWin,
            frameProvider,
            prefersReducedMotion: true
        });

        assert.equal(coordinator.isReducedMotion(), true);

        let scrollCalled = 0;
        coordinator.subscribeScroll(() => {
            scrollCalled++;
        });

        // Emit scroll events
        mockWin.scrollY = 300;
        mockWin.emit('scroll');

        // Continuous animation frame loop is suppressed
        assert.equal(frameProvider.queuedCount, 0);
        assert.equal(scrollCalled, 0);

        coordinator.destroy();
    });
});

describe('Navigation Motion Integration', () => {
    function createMockNavbar() {
        const classes = new Set();
        return {
            classList: {
                add: (cls) => classes.add(cls),
                remove: (cls) => classes.delete(cls),
                toggle: (cls, force) => {
                    if (force) classes.add(cls);
                    else classes.delete(cls);
                    return classes.has(cls);
                },
                contains: (cls) => classes.has(cls)
            }
        };
    }

    function createMockLink(href) {
        const classes = new Set();
        const attrs = {};
        return {
            getAttribute(name) {
                if (name === 'href') return href;
                return attrs[name] || null;
            },
            setAttribute(name, val) {
                attrs[name] = String(val);
            },
            removeAttribute(name) {
                delete attrs[name];
            },
            classList: {
                add: (cls) => classes.add(cls),
                remove: (cls) => classes.delete(cls),
                toggle: (cls, force) => {
                    if (force) classes.add(cls);
                    else classes.delete(cls);
                    return classes.has(cls);
                },
                contains: (cls) => classes.has(cls)
            }
        };
    }

    it('toggles navbar--scrolled based on coordinator scroll metrics without independent scroll listener', () => {
        const { wireNavigationMotion } = require('../motion.js');
        const mockWin = createMockWindow({ scrollY: 0 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const navbar = createMockNavbar();
        const navBinding = wireNavigationMotion({ coordinator, navbar });

        assert.equal(navbar.classList.contains('navbar--scrolled'), false);

        // Scroll past 50px
        mockWin.scrollY = 80;
        mockWin.emit('scroll');
        frameProvider.flush();

        assert.equal(navbar.classList.contains('navbar--scrolled'), true);

        // Scroll back up
        mockWin.scrollY = 20;
        mockWin.emit('scroll');
        frameProvider.flush();

        assert.equal(navbar.classList.contains('navbar--scrolled'), false);

        navBinding.destroy();
        coordinator.destroy();
    });

    it('updates active section indicator and aria-current as visitor scrolls', () => {
        const { wireNavigationMotion } = require('../motion.js');
        const mockWin = createMockWindow({ scrollY: 0, innerHeight: 800 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const linkHome = createMockLink('#home');
        const linkAbout = createMockLink('#about');
        const linkProjects = createMockLink('#projects');
        const links = [linkHome, linkAbout, linkProjects];

        // Dynamic bounds generator
        let sectionBounds = {
            home: { top: 0, bottom: 600 },
            about: { top: 600, bottom: 1400 },
            projects: { top: 1400, bottom: 2200 }
        };

        const sections = [
            { id: 'home', getBoundingClientRect: () => sectionBounds.home },
            { id: 'about', getBoundingClientRect: () => sectionBounds.about },
            { id: 'projects', getBoundingClientRect: () => sectionBounds.projects }
        ];

        const navBinding = wireNavigationMotion({
            coordinator,
            links,
            sections
        });

        // Initially #home is active
        assert.equal(linkHome.classList.contains('active'), true);
        assert.equal(linkHome.getAttribute('aria-current'), 'true');
        assert.equal(linkAbout.classList.contains('active'), false);
        assert.equal(linkAbout.getAttribute('aria-current'), null);

        // Scroll down so #about is in view
        mockWin.scrollY = 800;
        sectionBounds = {
            home: { top: -800, bottom: -200 },
            about: { top: -200, bottom: 600 },
            projects: { top: 600, bottom: 1400 }
        };
        mockWin.emit('scroll');
        frameProvider.flush();

        assert.equal(linkHome.classList.contains('active'), false);
        assert.equal(linkHome.getAttribute('aria-current'), null);
        assert.equal(linkAbout.classList.contains('active'), true);
        assert.equal(linkAbout.getAttribute('aria-current'), 'true');

        navBinding.destroy();

        // Further scrolls do not trigger nav updates after destroy
        mockWin.scrollY = 0;
        sectionBounds = {
            home: { top: 0, bottom: 600 },
            about: { top: 600, bottom: 1400 },
            projects: { top: 1400, bottom: 2200 }
        };
        mockWin.emit('scroll');
        frameProvider.flush();

        // Stays on about because navBinding was destroyed
        assert.equal(linkAbout.classList.contains('active'), true);

        coordinator.destroy();
    });
});

describe('Motion Coordinator - Pointer & Batched Phase Discipline', () => {
    it('absorbs pointermove and pointerleave, updating metrics and batching into a single frame', () => {
        const mockWin = createMockWindow({ innerWidth: 1024, innerHeight: 768 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        let pointerCalls = [];
        coordinator.subscribePointer((metrics) => {
            pointerCalls.push({ ...metrics });
        });

        assert.equal(frameProvider.queuedCount, 0);

        // Emit rapid pointer moves
        mockWin.emit('pointermove', { clientX: 100, clientY: 200 });
        mockWin.emit('pointermove', { clientX: 150, clientY: 250 });
        mockWin.emit('pointermove', { clientX: 200, clientY: 300 });

        // Batched into a single animation frame
        assert.equal(frameProvider.queuedCount, 1);
        assert.equal(pointerCalls.length, 0);

        frameProvider.flush();

        assert.equal(pointerCalls.length, 1);
        assert.equal(pointerCalls[0].pointerX, 200);
        assert.equal(pointerCalls[0].pointerY, 300);
        assert.equal(pointerCalls[0].pointerActive, true);

        // Emit pointerleave
        mockWin.emit('pointerleave');
        assert.equal(frameProvider.queuedCount, 1);
        frameProvider.flush();

        assert.equal(pointerCalls.length, 2);
        assert.equal(pointerCalls[1].pointerActive, false);

        coordinator.destroy();
    });

    it('enforces read-before-write phase discipline across subscribers', () => {
        const mockWin = createMockWindow();
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const executionOrder = [];

        // Subscriber A has read and write
        coordinator.subscribeScroll({
            read: (metrics) => {
                executionOrder.push('A:read');
                return { computedValue: 42 };
            },
            write: (state, metrics) => {
                executionOrder.push(`A:write:${state.computedValue}`);
            }
        });

        // Subscriber B has read and write
        coordinator.subscribeScroll({
            read: (metrics) => {
                executionOrder.push('B:read');
                return { computedValue: 99 };
            },
            write: (state, metrics) => {
                executionOrder.push(`B:write:${state.computedValue}`);
            }
        });

        mockWin.scrollY = 100;
        mockWin.emit('scroll');
        frameProvider.flush();

        // ALL reads must precede ANY writes
        assert.deepEqual(executionOrder, [
            'A:read',
            'B:read',
            'A:write:42',
            'B:write:99'
        ]);

        coordinator.destroy();
    });

    it('suppresses pointer frame loops when reduced-motion is enabled', () => {
        const mockWin = createMockWindow();
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({
            window: mockWin,
            frameProvider,
            prefersReducedMotion: true
        });

        let pointerCalled = false;
        coordinator.subscribePointer(() => {
            pointerCalled = true;
        });

        mockWin.emit('pointermove', { clientX: 100, clientY: 200 });

        assert.equal(frameProvider.queuedCount, 0);
        assert.equal(pointerCalled, false);

        coordinator.destroy();
    });
});

describe('Parallax Motion Integration', () => {
    function createMockElement(initial = {}) {
        const style = { transform: '' };
        const rect = initial.rect || { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 };
        return {
            style,
            getBoundingClientRect: () => rect
        };
    }

    it('shifts hero background particles with perspective depth on pointer movement via coordinator', () => {
        const { wireParallaxMotion } = require('../motion.js');
        const mockWin = createMockWindow({ innerWidth: 1024, innerHeight: 768 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const hero = createMockElement({ rect: { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 } });
        const particles = [
            createMockElement(),
            createMockElement(),
            createMockElement()
        ];

        const parallax = wireParallaxMotion({
            coordinator,
            hero,
            particles
        });

        // Pointer move near center-right
        mockWin.emit('pointermove', { clientX: 750, clientY: 450 });
        frameProvider.flush();

        // Particles shifted based on depth factors
        assert.notEqual(particles[0].style.transform, '');
        assert.match(particles[0].style.transform, /^translate3d\(/);
        assert.notEqual(particles[1].style.transform, '');
        // Different depth factor across particles
        assert.notEqual(particles[0].style.transform, particles[1].style.transform);

        parallax.destroy();
        coordinator.destroy();
    });

    it('resets particle transforms cleanly when pointer leaves', () => {
        const { wireParallaxMotion } = require('../motion.js');
        const mockWin = createMockWindow({ innerWidth: 1024, innerHeight: 768 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const hero = createMockElement({ rect: { left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 } });
        const particles = [createMockElement(), createMockElement()];

        const parallax = wireParallaxMotion({ coordinator, hero, particles });

        mockWin.emit('pointermove', { clientX: 600, clientY: 400 });
        frameProvider.flush();
        assert.notEqual(particles[0].style.transform, '');

        // Emit pointerleave
        mockWin.emit('pointerleave');
        frameProvider.flush();

        // Transforms reset to empty string
        assert.equal(particles[0].style.transform, '');
        assert.equal(particles[1].style.transform, '');

        parallax.destroy();
        coordinator.destroy();
    });

    it('translates hero slightly on scroll through coordinator scroll subscription', () => {
        const { wireParallaxMotion } = require('../motion.js');
        const mockWin = createMockWindow({ innerWidth: 1024, innerHeight: 768, scrollY: 0 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const hero = createMockElement();
        const particles = [];

        const parallax = wireParallaxMotion({ coordinator, hero, particles });

        mockWin.scrollY = 200;
        mockWin.emit('scroll');
        frameProvider.flush();

        assert.equal(hero.style.transform, 'translateY(-18.00px)');

        parallax.destroy();
        coordinator.destroy();
    });

    it('remains statically positioned when reduced-motion is enabled', () => {
        const { wireParallaxMotion } = require('../motion.js');
        const mockWin = createMockWindow();
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({
            window: mockWin,
            frameProvider,
            prefersReducedMotion: true
        });

        const hero = createMockElement();
        const particles = [createMockElement()];

        const parallax = wireParallaxMotion({ coordinator, hero, particles });

        mockWin.emit('pointermove', { clientX: 700, clientY: 500 });
        assert.equal(frameProvider.queuedCount, 0);
        assert.equal(particles[0].style.transform, '');
        assert.equal(hero.style.transform, '');

        parallax.destroy();
        coordinator.destroy();
    });
});

describe('Horizontal Scroll Track Integration', () => {
    function createMockTrackElements(options = {}) {
        const wrapAttrs = {};
        const wrapStyles = {};
        let wrapRect = options.wrapRect || { top: 0, bottom: 2000, height: 2000, width: 1200 };

        const wrap = {
            style: {
                setProperty(name, val) { wrapStyles[name] = String(val); },
                removeProperty(name) { delete wrapStyles[name]; },
                get(name) { return wrapStyles[name]; }
            },
            setAttribute(name, val) { wrapAttrs[name] = String(val); },
            removeAttribute(name) { delete wrapAttrs[name]; },
            getAttribute(name) { return wrapAttrs[name] || null; },
            getBoundingClientRect: () => wrapRect,
            setRect(r) { wrapRect = r; },
            querySelector: () => container
        };

        const container = {
            clientWidth: options.containerWidth || 1000
        };

        const row = {
            scrollWidth: options.rowWidth || 2500,
            style: { transform: '' }
        };

        return { wrap, container, row };
    }

    it('translates horizontal track based on scroll progress in write phase without layout thrashing', () => {
        const { wireHorizontalScroll } = require('../motion.js');
        const mockWin = createMockWindow({ innerWidth: 1200, innerHeight: 800, scrollY: 0 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({ window: mockWin, frameProvider });

        const { wrap, container, row } = createMockTrackElements({
            containerWidth: 1000,
            rowWidth: 2000 // maxScrollX = 1000
        });

        const hscroll = wireHorizontalScroll({
            coordinator,
            tracks: [{
                wrap,
                row,
                container,
                cssVar: '--hscroll-height',
                getNavHeight: () => 70
            }]
        });

        // Desktop layout initialized
        assert.equal(wrap.getAttribute('data-hscroll-ready'), 'true');
        assert.notEqual(wrap.style.get('--hscroll-height'), undefined);

        // Track is above trigger start
        wrap.setRect({ top: 500, bottom: 2500, height: 2000, width: 1200 });
        mockWin.scrollY = 100;
        mockWin.emit('scroll');
        frameProvider.flush();
        assert.equal(row.style.transform, 'translate3d(0px, 0, 0)');

        // Scroll track midway through travel area
        // totalScrollArea = rect.height - triggerEnd + triggerStart = 2000 - 800 + 70 = 1270
        // progress = (triggerStart - rect.top) / totalScrollArea
        // With triggerStart = 70, rect.top = -565 => progress = 635 / 1270 = 0.5
        wrap.setRect({ top: -565, bottom: 1435, height: 2000, width: 1200 });
        mockWin.scrollY = 600;
        mockWin.emit('scroll');
        frameProvider.flush();

        assert.equal(row.style.transform, 'translate3d(-500px, 0, 0)');

        hscroll.destroy();
        coordinator.destroy();
    });

    it('switches cleanly between desktop horizontal track and mobile native layout on resize', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        const { wireHorizontalScroll } = require('../motion.js');
        const mockWin = createMockWindow({ innerWidth: 1200, innerHeight: 800 });
        const coordinator = createMotionCoordinator({ window: mockWin, resizeDebounceMs: 100 });

        const { wrap, container, row } = createMockTrackElements();

        const hscroll = wireHorizontalScroll({
            coordinator,
            tracks: [{ wrap, row, container, cssVar: '--hscroll-height' }]
        });

        assert.equal(wrap.getAttribute('data-hscroll-ready'), 'true');

        // Resize down to mobile (< 900px)
        mockWin.innerWidth = 600;
        mockWin.emit('resize');
        t.mock.timers.tick(100);

        // Mobile snap layout mode activated
        assert.equal(wrap.getAttribute('data-hscroll-ready'), null);
        assert.equal(wrap.style.get('--hscroll-height'), undefined);
        assert.equal(row.style.transform, '');

        // Resize back up to desktop (> 900px)
        mockWin.innerWidth = 1024;
        mockWin.emit('resize');
        t.mock.timers.tick(100);

        assert.equal(wrap.getAttribute('data-hscroll-ready'), 'true');

        hscroll.destroy();
        coordinator.destroy();
    });

    it('remains statically positioned and unattached when reduced-motion is enabled', () => {
        const { wireHorizontalScroll } = require('../motion.js');
        const mockWin = createMockWindow({ innerWidth: 1200, innerHeight: 800 });
        const frameProvider = createMockFrameProvider();
        const coordinator = createMotionCoordinator({
            window: mockWin,
            frameProvider,
            prefersReducedMotion: true
        });

        const { wrap, container, row } = createMockTrackElements();

        const hscroll = wireHorizontalScroll({
            coordinator,
            tracks: [{ wrap, row, container, cssVar: '--hscroll-height' }]
        });

        assert.equal(wrap.getAttribute('data-hscroll-ready'), null);
        assert.equal(wrap.style.get('--hscroll-height'), undefined);

        mockWin.scrollY = 500;
        mockWin.emit('scroll');
        assert.equal(frameProvider.queuedCount, 0);
        assert.equal(row.style.transform, '');

        hscroll.destroy();
        coordinator.destroy();
    });
});



