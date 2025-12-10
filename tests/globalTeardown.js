const teardownPuppeteer = require('jest-environment-puppeteer/teardown');

module.exports = async function (globalConfig) {
    try {
        if (global.__staticServer) {
            try {
                global.__staticServer.close();
            } catch (e) {
                // ignore
            }
            delete global.__staticServer;
        }

        await teardownPuppeteer(globalConfig);
    } catch (err) {
        // swallow errors during teardown
        console.warn('globalTeardown error:', err && err.message);
    }
};
