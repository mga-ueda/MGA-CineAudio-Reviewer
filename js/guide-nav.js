(function () {
    'use strict';

    var nav = document.querySelector('.guide-nav');
    if (!nav) return;

    var groups = Array.prototype.slice.call(nav.querySelectorAll('.guide-nav__group'));
    if (!groups.length) return;

    var anchorToChapter = Object.create(null);
    groups.forEach(function (group) {
        var chapterId = group.getAttribute('data-section');
        if (!chapterId) return;
        anchorToChapter[chapterId] = chapterId;
        group.querySelectorAll('.guide-nav__sublist a[href^="#"]').forEach(function (link) {
            var id = link.getAttribute('href').slice(1);
            if (id) anchorToChapter[id] = chapterId;
        });
    });

    var scrollTargets = Array.prototype.slice.call(
        document.querySelectorAll('.guide-section[id], .guide-section h3[id]')
    );
    if (!scrollTargets.length) return;

    var navLinks = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
    var scrollOffset = 24;
    var ticking = false;

    function chapterForAnchor(anchorId) {
        return anchorToChapter[anchorId] || null;
    }

    function activeAnchorFromScroll() {
        var y = window.scrollY + scrollOffset;
        var activeId = scrollTargets[0].id;
        for (var i = 0; i < scrollTargets.length; i++) {
            if (scrollTargets[i].offsetTop <= y) {
                activeId = scrollTargets[i].id;
            } else {
                break;
            }
        }
        return activeId;
    }

    function activeAnchorFromHash() {
        var hash = window.location.hash;
        if (!hash || hash.length < 2) return null;
        var id = decodeURIComponent(hash.slice(1));
        return document.getElementById(id) ? id : null;
    }

    function resolveActiveAnchor(useHash) {
        if (useHash) {
            var fromHash = activeAnchorFromHash();
            if (fromHash) return fromHash;
        }
        return activeAnchorFromScroll();
    }

    function setExpandedGroup(chapterId) {
        groups.forEach(function (group) {
            var sectionId = group.getAttribute('data-section');
            var open = sectionId === chapterId;
            group.classList.toggle('guide-nav__group--open', open);
            var sublist = group.querySelector('.guide-nav__sublist');
            if (sublist) sublist.hidden = !open;
        });
    }

    function updateNavState(useHash) {
        var activeId = resolveActiveAnchor(!!useHash);
        var chapterId = chapterForAnchor(activeId);

        setExpandedGroup(chapterId);

        navLinks.forEach(function (link) {
            var href = link.getAttribute('href');
            var match = href && href.charAt(0) === '#' && href.slice(1) === activeId;
            if (match) {
                link.setAttribute('aria-current', 'location');
            } else {
                link.removeAttribute('aria-current');
            }
        });
    }

    function onScrollOrResize() {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
            ticking = false;
            updateNavState(false);
        });
    }

    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('hashchange', function () {
        updateNavState(true);
    });

    updateNavState(!!window.location.hash);
})();
