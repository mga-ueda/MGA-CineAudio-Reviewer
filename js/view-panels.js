/**
 * view-panels.js — マニュアル折りたたみの表示補助。
 */
    function revealManualDocFold(fold) {
        if (!fold) return;
        fold.hidden = false;
        if (fold.open) {
            if (typeof scrollAppDocFoldIntoView === 'function') {
                scrollAppDocFoldIntoView(fold);
            }
        } else {
            fold.open = true;
        }
    }

    window.revealManualDocFold = revealManualDocFold;
