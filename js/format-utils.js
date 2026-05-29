(function formatUtilsModule() {
    function fileExtLower(name) {
        const s = String(name || '').toLowerCase();
        const dot = s.lastIndexOf('.');
        if (dot < 0) return '';
        return s.slice(dot);
    }

    function formatByteSize(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n < 1) return '0 B';
        if (n < 1024) return Math.round(n) + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
        return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    window.fileExtLower = fileExtLower;
    window.formatByteSize = formatByteSize;
})();
