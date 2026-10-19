/**
 * Unified Motion Coordinator Engine
 * Performance-oriented, batched frame scheduling with reduced-motion enforcement.
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.PortfolioMotion = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Creates a centralized Motion Coordinator.
     * @param {Object} [options]
     * @param {Window} [options.window] - Window environment.
     * @param {Object} [options.frameProvider] - Custom frame scheduler { requestFrame, cancelFrame }.
     * @param {boolean} [options.prefersReducedMotion] - Override reduced motion check.
     */
    function createMotionCoordinator(options = {}) {
        const win = options.window || (typeof window !== 'undefined' ? window : null);
        const frameProvider = options.frameProvider || {
            requestFrame: (cb) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16)),
            cancelFrame: (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id))
        };

        const resizeDebounceMs = typeof options.resizeDebounceMs === 'number' ? options.resizeDebounceMs : 150;
        const isReduced = typeof options.prefersReducedMotion === 'boolean'
            ? options.prefersReducedMotion
            : Boolean(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

        const scrollSubscribers = new Set();
        const resizeSubscribers = new Set();
        const pointerSubscribers = new Set();
        let frameScheduled = false;
        let frameId = null;
        let resizeTimerId = null;

        const metrics = {
            scrollY: win ? win.scrollY || 0 : 0,
            scrollX: win ? win.scrollX || 0 : 0,
            innerWidth: win ? win.innerWidth || 0 : 0,
            innerHeight: win ? win.innerHeight || 0 : 0,
            pointerX: 0,
            pointerY: 0,
            pointerActive: false
        };

        function readMetrics() {
            if (!win) return;
            metrics.scrollY = win.scrollY || 0;
            metrics.scrollX = win.scrollX || 0;
            metrics.innerWidth = win.innerWidth || 0;
            metrics.innerHeight = win.innerHeight || 0;
        }

        readMetrics();

        function scheduleFrame() {
            if (isReduced || frameScheduled) return;
            frameScheduled = true;
            frameId = frameProvider.requestFrame((timestamp) => {
                frameScheduled = false;
                readMetrics();

                // 1. Batched READ phase
                const scrollReads = new Map();
                for (const sub of scrollSubscribers) {
                    if (typeof sub.read === 'function') {
                        scrollReads.set(sub, sub.read(metrics, timestamp));
                    }
                }

                const pointerReads = new Map();
                for (const sub of pointerSubscribers) {
                    if (typeof sub.read === 'function') {
                        pointerReads.set(sub, sub.read(metrics, timestamp));
                    }
                }

                // 2. Batched WRITE phase
                for (const sub of scrollSubscribers) {
                    if (typeof sub.write === 'function') {
                        sub.write(scrollReads.get(sub), metrics, timestamp);
                    } else if (typeof sub === 'function') {
                        sub(metrics, timestamp);
                    }
                }

                for (const sub of pointerSubscribers) {
                    if (typeof sub.write === 'function') {
                        sub.write(pointerReads.get(sub), metrics, timestamp);
                    } else if (typeof sub === 'function') {
                        sub(metrics, timestamp);
                    }
                }
            });
        }

        const handleScroll = () => {
            scheduleFrame();
        };

        const handleResize = () => {
            if (resizeTimerId !== null) {
                clearTimeout(resizeTimerId);
            }
            resizeTimerId = setTimeout(() => {
                readMetrics();
                for (const sub of resizeSubscribers) {
                    sub(metrics);
                }
                resizeTimerId = null;
            }, resizeDebounceMs);
        };

        const handlePointerMove = (e) => {
            metrics.pointerX = typeof e.clientX === 'number' ? e.clientX : 0;
            metrics.pointerY = typeof e.clientY === 'number' ? e.clientY : 0;
            metrics.pointerActive = true;
            scheduleFrame();
        };

        const handlePointerLeave = () => {
            metrics.pointerActive = false;
            scheduleFrame();
        };

        if (win && typeof win.addEventListener === 'function') {
            win.addEventListener('scroll', handleScroll, { passive: true });
            win.addEventListener('resize', handleResize, { passive: true });
            win.addEventListener('pointermove', handlePointerMove, { passive: true });
            win.addEventListener('pointerleave', handlePointerLeave, { passive: true });
        }

        return {
            subscribeScroll(fn) {
                scrollSubscribers.add(fn);
                return () => {
                    scrollSubscribers.delete(fn);
                };
            },
            subscribeResize(fn) {
                resizeSubscribers.add(fn);
                return () => {
                    resizeSubscribers.delete(fn);
                };
            },
            subscribePointer(fn) {
                pointerSubscribers.add(fn);
                return () => {
                    pointerSubscribers.delete(fn);
                };
            },
            getMetrics() {
                return { ...metrics };
            },
            isReducedMotion() {
                return isReduced;
            },
            destroy() {
                if (win && typeof win.removeEventListener === 'function') {
                    win.removeEventListener('scroll', handleScroll);
                    win.removeEventListener('resize', handleResize);
                    win.removeEventListener('pointermove', handlePointerMove);
                    win.removeEventListener('pointerleave', handlePointerLeave);
                }
                if (frameId !== null && frameProvider.cancelFrame) {
                    frameProvider.cancelFrame(frameId);
                }
                if (resizeTimerId !== null) {
                    clearTimeout(resizeTimerId);
                    resizeTimerId = null;
                }
                frameScheduled = false;
                scrollSubscribers.clear();
                resizeSubscribers.clear();
                pointerSubscribers.clear();
            }
        };
    }

    /**
     * Wires navigation bar behaviors exclusively through the Motion Coordinator seam.
     * @param {Object} options
     * @param {Object} options.coordinator - Motion Coordinator instance.
     * @param {Element} [options.navbar] - Navbar element.
     * @param {Array|NodeList} [options.links] - Navigation links.
     * @param {Array|NodeList} [options.sections] - Tracked sections.
     * @returns {Object} Controller with destroy().
     */
    function wireNavigationMotion(options = {}) {
        const coordinator = options.coordinator;
        const navbar = options.navbar;
        const links = options.links || [];
        const sections = options.sections || [];

        if (!coordinator) {
            return { destroy: () => {} };
        }

        const unsubs = [];

        const updateNavbar = (metrics) => {
            if (!navbar || !navbar.classList) return;
            const isScrolled = (metrics.scrollY || 0) > 50;
            navbar.classList.toggle('navbar--scrolled', isScrolled);
        };

        const updateSections = (metrics) => {
            if (!links.length || !sections.length) return;
            const viewportHeight = metrics.innerHeight || 800;
            const triggerOffset = Math.min(200, viewportHeight * 0.35);

            let activeId = null;

            for (const section of sections) {
                if (typeof section.getBoundingClientRect !== 'function') continue;
                const rect = section.getBoundingClientRect();
                if (rect.top <= triggerOffset && rect.bottom > triggerOffset) {
                    activeId = section.id;
                    break;
                }
            }

            if (!activeId && (metrics.scrollY || 0) <= 50 && sections[0]) {
                activeId = sections[0].id;
            }

            if (activeId) {
                for (const link of links) {
                    if (typeof link.getAttribute !== 'function') continue;
                    const href = link.getAttribute('href');
                    const isMatch = href === '#' + activeId;
                    if (link.classList && typeof link.classList.toggle === 'function') {
                        link.classList.toggle('active', isMatch);
                    }
                    if (isMatch) {
                        if (typeof link.setAttribute === 'function') {
                            link.setAttribute('aria-current', 'true');
                        }
                    } else {
                        if (typeof link.removeAttribute === 'function') {
                            link.removeAttribute('aria-current');
                        }
                    }
                }
            }
        };

        const onMotionTick = (metrics) => {
            updateNavbar(metrics);
            updateSections(metrics);
        };

        // Initialize immediately with cached metrics
        const initialMetrics = coordinator.getMetrics();
        onMotionTick(initialMetrics);

        unsubs.push(coordinator.subscribeScroll(onMotionTick));

        return {
            destroy() {
                unsubs.forEach(unsub => unsub());
            }
        };
    }

    /**
     * Wires hero parallax particle and scroll motion through the Motion Coordinator seam.
     * @param {Object} options
     * @param {Object} options.coordinator - Motion Coordinator instance.
     * @param {Element} [options.hero] - Hero section element.
     * @param {Array|NodeList} [options.particles] - Particle elements.
     * @returns {Object} Controller with destroy().
     */
    function wireParallaxMotion(options = {}) {
        const coordinator = options.coordinator;
        const hero = options.hero;
        const particles = Array.from(options.particles || []);

        if (!coordinator || coordinator.isReducedMotion()) {
            return {
                destroy() {
                    if (hero && hero.style) hero.style.transform = '';
                    particles.forEach(p => { if (p && p.style) p.style.transform = ''; });
                }
            };
        }

        const unsubs = [];
        let heroRect = null;

        function updateHeroRect() {
            if (hero && typeof hero.getBoundingClientRect === 'function') {
                heroRect = hero.getBoundingClientRect();
            }
        }

        updateHeroRect();
        unsubs.push(coordinator.subscribeResize(() => {
            updateHeroRect();
        }));

        // Scroll subscription for hero subtle parallax
        if (hero) {
            unsubs.push(coordinator.subscribeScroll((metrics) => {
                if ((metrics.innerWidth || 1024) > 768) {
                    const scrollY = metrics.scrollY || 0;
                    const innerHeight = metrics.innerHeight || 768;
                    if (scrollY < innerHeight) {
                        hero.style.transform = `translateY(${(scrollY * -0.09).toFixed(2)}px)`;
                    }
                }
            }));
        }

        // Pointer subscription with read/write phase separation
        if (particles.length > 0) {
            unsubs.push(coordinator.subscribePointer({
                read: (metrics) => {
                    if (!metrics.pointerActive) {
                        return { active: false };
                    }
                    const rect = hero && typeof hero.getBoundingClientRect === 'function'
                        ? hero.getBoundingClientRect()
                        : heroRect;

                    if (!rect) return { active: false };

                    const px = metrics.pointerX;
                    const py = metrics.pointerY;

                    const isInside = (
                        px >= rect.left &&
                        px <= rect.right &&
                        py >= rect.top &&
                        py <= rect.bottom
                    );

                    if (!isInside) {
                        return { active: false };
                    }

                    const centerX = (rect.width || 1) / 2;
                    const centerY = (rect.height || 1) / 2;
                    const mouseX = (px - rect.left - centerX) / centerX;
                    const mouseY = (py - rect.top - centerY) / centerY;

                    return {
                        active: true,
                        mouseX,
                        mouseY
                    };
                },
                write: (state) => {
                    if (!state || !state.active) {
                        particles.forEach(p => {
                            if (p && p.style && p.style.transform) {
                                p.style.transform = '';
                            }
                        });
                        return;
                    }

                    particles.forEach((particle, index) => {
                        if (!particle || !particle.style) return;
                        const depthFactor = (index % 2 ? 0.3 : 0.5) * ((index % 3) + 1);
                        const moveX = (state.mouseX * 14 * depthFactor).toFixed(2);
                        const moveY = (state.mouseY * 10 * depthFactor).toFixed(2);
                        particle.style.transform = `translate3d(${moveX}px, ${moveY}px, 0)`;
                    });
                }
            }));
        }

        return {
            destroy() {
                unsubs.forEach(unsub => unsub());
                if (hero && hero.style) hero.style.transform = '';
                particles.forEach(p => { if (p && p.style) p.style.transform = ''; });
            }
        };
    }

    /**
     * Wires horizontal scroll tracks (skills & achievements) through the Motion Coordinator seam.
     * Enforces strict read/write phase separation and debounced desktop/mobile mode switching.
     * @param {Object} options
     * @param {Object} options.coordinator - Motion Coordinator instance.
     * @param {Array<Object>} [options.tracks] - Array of track configs { wrap, row, container, cssVar, minWidth, getNavHeight }.
     * @returns {Object} Controller with destroy().
     */
    function wireHorizontalScroll(options = {}) {
        const coordinator = options.coordinator;
        const tracks = options.tracks || [];

        if (!coordinator || coordinator.isReducedMotion()) {
            return {
                destroy() {
                    tracks.forEach(t => {
                        if (!t) return;
                        if (t.wrap) {
                            if (t.cssVar && t.wrap.style && t.wrap.style.removeProperty) t.wrap.style.removeProperty(t.cssVar);
                            if (t.wrap.removeAttribute) t.wrap.removeAttribute('data-hscroll-ready');
                        }
                        if (t.row && t.row.style) t.row.style.transform = '';
                    });
                }
            };
        }

        const unsubs = [];

        const trackStates = tracks.map(t => ({
            wrap: t.wrap,
            row: t.row,
            container: t.container || (t.wrap && t.wrap.querySelector ? t.wrap.querySelector('.container') : null),
            cssVar: t.cssVar,
            minWidth: typeof t.minWidth === 'number' ? t.minWidth : 900,
            getNavHeight: typeof t.getNavHeight === 'function' ? t.getNavHeight : (() => 70),
            isEnabled: false,
            maxScrollX: 0,
            triggerStart: 0,
            triggerEnd: 0
        }));

        function updateLayout(metrics) {
            const innerWidth = metrics.innerWidth || 1024;
            const innerHeight = metrics.innerHeight || 768;

            trackStates.forEach(state => {
                const { wrap, row, container, cssVar, minWidth, getNavHeight } = state;
                if (!wrap || !row) return;

                const enabled = innerWidth > minWidth;
                state.isEnabled = enabled;

                if (!enabled) {
                    if (cssVar && wrap.style && wrap.style.removeProperty) wrap.style.removeProperty(cssVar);
                    if (wrap.removeAttribute) wrap.removeAttribute('data-hscroll-ready');
                    if (row.style) row.style.transform = '';
                    return;
                }

                const contWidth = container ? container.clientWidth : 0;
                const scrollW = row.scrollWidth || 0;
                const maxScrollX = Math.max(0, scrollW - contWidth);
                state.maxScrollX = maxScrollX;

                const navHeight = getNavHeight();
                const travelDistance = maxScrollX * 1.8 + 300;
                const totalHeight = Math.max(travelDistance, innerHeight - navHeight + 200);

                if (cssVar && wrap.style && wrap.style.setProperty) {
                    wrap.style.setProperty(cssVar, `${totalHeight}px`);
                }
                if (wrap.setAttribute) {
                    wrap.setAttribute('data-hscroll-ready', 'true');
                }

                state.triggerStart = navHeight;
                state.triggerEnd = innerHeight;
            });
        }

        const initialMetrics = coordinator.getMetrics();
        updateLayout(initialMetrics);

        unsubs.push(coordinator.subscribeResize((metrics) => {
            updateLayout(metrics);
        }));

        unsubs.push(coordinator.subscribeScroll({
            read: () => {
                return trackStates.map(state => {
                    if (!state.isEnabled || !state.wrap || typeof state.wrap.getBoundingClientRect !== 'function') {
                        return { isEnabled: false };
                    }

                    const rect = state.wrap.getBoundingClientRect();
                    const totalScrollArea = rect.height - state.triggerEnd + state.triggerStart;
                    let targetX = 0;

                    if (rect.top <= state.triggerStart && rect.bottom > state.triggerEnd) {
                        const progress = Math.min(1, Math.max(0, (state.triggerStart - rect.top) / Math.max(1, totalScrollArea)));
                        targetX = -progress * state.maxScrollX;
                    } else if (rect.top > state.triggerStart) {
                        targetX = 0;
                    } else if (rect.bottom <= state.triggerEnd) {
                        targetX = -state.maxScrollX;
                    }

                    return {
                        isEnabled: true,
                        targetX: Math.round(targetX) === targetX ? targetX : Number(targetX.toFixed(2))
                    };
                });
            },
            write: (readResults) => {
                if (!Array.isArray(readResults)) return;
                readResults.forEach((res, i) => {
                    const state = trackStates[i];
                    if (!state || !state.row || !state.row.style) return;
                    if (!res || !res.isEnabled) return;
                    state.row.style.transform = `translate3d(${res.targetX}px, 0, 0)`;
                });
            }
        }));

        return {
            destroy() {
                unsubs.forEach(unsub => unsub());
                trackStates.forEach(state => {
                    if (state.wrap) {
                        if (state.cssVar && state.wrap.style && state.wrap.style.removeProperty) state.wrap.style.removeProperty(state.cssVar);
                        if (state.wrap.removeAttribute) state.wrap.removeAttribute('data-hscroll-ready');
                    }
                    if (state.row && state.row.style) state.row.style.transform = '';
                });
            }
        };
    }

    return {
        createMotionCoordinator,
        wireNavigationMotion,
        wireParallaxMotion,
        wireHorizontalScroll
    };
}));
