/**
 * Mohammed Shariq Shariff - Portfolio Application Script
 * * Architecture: Modular, Vanilla ES6+, Performance-Optimized
 */

(() => {
    'use strict';

    // --- Configuration ---
    const CONFIG = {
        typewriterSpeed: 90
    };

    // --- Utilities ---
    const $ = (selector, context = document) => context.querySelector(selector);
    const $$ = (selector, context = document) => context.querySelectorAll(selector);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- UI Modules ---
    function initTypewriter() {
        const title = $('.typewriter');
        const subtitle = $('.typewriter-subtitle');

        if (!title && !subtitle) return;

        if (prefersReducedMotion) {
            if (title) title.textContent = title.dataset.text || '';
            if (subtitle) {
                const firstWord = (subtitle.dataset.texts || '').split(',')[0];
                if (firstWord) subtitle.textContent = firstWord;
            }
            return;
        }

        if (title) {
            const text = title.dataset.text || '';
            let charIndex = 0;
            const startTime = performance.now() + 600;

            const typeStep = (timestamp) => {
                if (document.hidden) return requestAnimationFrame(typeStep);
                if (timestamp < startTime) return requestAnimationFrame(typeStep);

                const targetLength = Math.min(text.length, Math.floor((timestamp - startTime) / CONFIG.typewriterSpeed));

                if (targetLength !== charIndex) {
                    charIndex = targetLength;
                    title.textContent = text.slice(0, charIndex);
                }

                if (charIndex < text.length) {
                    requestAnimationFrame(typeStep);
                }
            };

            title.textContent = '';
            requestAnimationFrame(typeStep);
        }

        if (subtitle) {
            const words = (subtitle.dataset.texts || '').split(',').map(w => w.trim()).filter(Boolean);
            if (!words.length) return;

            let wordIndex = 0;
            let charCount = 0;
            let isDeleting = false;
            let pauseUntil = 0;
            let lastTime = performance.now();

            const loopStep = (timestamp) => {
                if (document.hidden) {
                    lastTime = timestamp;
                    return requestAnimationFrame(loopStep);
                }

                const deltaTime = timestamp - lastTime;
                lastTime = timestamp;
                const currentWord = words[wordIndex];

                if (!isDeleting) {
                    charCount += deltaTime / 140;
                    if (charCount >= currentWord.length) {
                        charCount = currentWord.length;
                        isDeleting = true;
                        pauseUntil = timestamp + 1800;
                    }
                } else if (timestamp > pauseUntil) {
                    charCount -= deltaTime / 110;
                    if (charCount <= 0) {
                        charCount = 0;
                        isDeleting = false;
                        wordIndex = (wordIndex + 1) % words.length;
                    }
                }

                subtitle.textContent = currentWord.slice(0, Math.floor(Math.max(0, Math.min(currentWord.length, charCount))));
                requestAnimationFrame(loopStep);
            };

            requestAnimationFrame(loopStep);
        }
    }

    function initNavigation(coordinator) {
        const hamburger = $('#hamburger');
        const menu = $('#nav-menu');
        const links = $$('.nav-link');
        const navbar = $('.navbar');

        const toggleMenu = (forceClose = false) => {
            if (!hamburger || !menu) return;
            const isClosing = forceClose || menu.classList.contains('active');

            if (isClosing) {
                hamburger.classList.remove('active');
                menu.classList.remove('active');
                document.body.style.overflow = '';
            } else {
                hamburger.classList.add('active');
                menu.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        };

        if (hamburger && menu) {
            hamburger.addEventListener('click', () => toggleMenu());

            document.addEventListener('click', (e) => {
                if (!hamburger.contains(e.target) && !menu.contains(e.target)) {
                    toggleMenu(true);
                }
            });
        }

        links.forEach(link => {
            link.addEventListener('click', (e) => {
                if (link.getAttribute('href') === '#') e.preventDefault();
                toggleMenu(true);
            });
        });

        // Wire navigation behaviors exclusively through Motion Coordinator
        if (coordinator && window.PortfolioMotion) {
            window.PortfolioMotion.wireNavigationMotion({
                coordinator,
                navbar,
                links,
                sections: $$('section[id]')
            });

            coordinator.subscribeResize((metrics) => {
                if (metrics.innerWidth > 768) toggleMenu(true);
            });
        } else {
            // Safe fallback if coordinator is unavailable
            if (navbar) {
                const onScroll = () => navbar.classList.toggle('navbar--scrolled', window.scrollY > 50);
                window.addEventListener('scroll', onScroll, { passive: true });
                onScroll();
            }
        }
    }

    function initParallax(coordinator) {
        const hero = $('.hero');
        if (!hero) return;

        const particles = $$('.particle', hero);

        if (coordinator && window.PortfolioMotion && window.PortfolioMotion.wireParallaxMotion) {
            window.PortfolioMotion.wireParallaxMotion({
                coordinator,
                hero,
                particles
            });
        }
    }

    function initHorizontalScroll(coordinator) {
        const tracks = [
            {
                wrap: $('.skills.skills--hscroll'),
                row: $('.skills.skills--hscroll .skills-grid-min'),
                container: $('.skills.skills--hscroll .container'),
                cssVar: '--hscroll-height',
                getNavHeight: () => $('.navbar')?.offsetHeight || 70
            },
            {
                wrap: $('#achievements.achievements--hscroll'),
                row: $('#achievements.achievements--hscroll .achievements-grid'),
                container: $('#achievements.achievements--hscroll .container'),
                cssVar: '--ach-h',
                getNavHeight: () => $('.navbar')?.offsetHeight || 70
            }
        ].filter(t => t.wrap && t.row);

        if (!tracks.length) return;

        if (coordinator && window.PortfolioMotion && window.PortfolioMotion.wireHorizontalScroll) {
            window.PortfolioMotion.wireHorizontalScroll({
                coordinator,
                tracks
            });
        }
    }

    function initRippleEffect() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn');
            if (!btn) return;

            const rect = btn.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height);

            const ripple = document.createElement('span');
            ripple.className = 'ripple-circle';
            ripple.style.width = ripple.style.height = `${size}px`;
            ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
            ripple.style.top = `${e.clientY - rect.top - size / 2}px`;

            btn.appendChild(ripple);

            setTimeout(() => ripple.remove(), 520);
        });
    }

    // --- Application Initialization ---
    document.addEventListener('DOMContentLoaded', () => {
        const motionCoordinator = window.PortfolioMotion
            ? window.PortfolioMotion.createMotionCoordinator({ window })
            : null;
        window.__portfolioMotionCoordinator = motionCoordinator;

        // 1. Initialize Critical Visuals & Navigation First
        initTypewriter();
        initNavigation(motionCoordinator);

        // 2. Defer Non-Critical Effects to keep main thread unblocked
        const defer = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
        defer(() => {
            initParallax(motionCoordinator);
            initHorizontalScroll(motionCoordinator);
            initRippleEffect();
        });

        document.body.classList.add('loaded');
    });

})();