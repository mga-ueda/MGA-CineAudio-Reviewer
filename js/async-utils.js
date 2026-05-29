(function asyncUtilsModule() {
    function yieldToBrowser() {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function deepCloneJson(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    window.yieldToBrowser = yieldToBrowser;
    window.deepCloneJson = deepCloneJson;
})();
