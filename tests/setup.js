import { setup as setupDevServer } from 'jest-dev-server';
// Import the setup helper from jest-environment-puppeteer to initialize browsers
import setupPuppeteer from 'jest-environment-puppeteer/setup';
import chalk from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DIR = path.join(os.tmpdir(), 'jest_puppeteer_global_setup');
import http from 'http';

function createStaticServer(rootDir, port = 3000) {
    const server = http.createServer((req, res) => {
        try {
            let urlPath = decodeURI(req.url.split('?')[0]);
            if (urlPath === '/' ) urlPath = '/index.html';
            const filePath = path.join(rootDir, urlPath);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const stream = fs.createReadStream(filePath);
                res.statusCode = 200;
                stream.pipe(res);
            } else {
                res.statusCode = 404;
                res.end('Not Found');
            }
        } catch (err) {
            res.statusCode = 500;
            res.end('Server Error');
        }
    });

    return new Promise((resolve, reject) => {
        const onError = (err) => {
            if (err && err.code === 'EADDRINUSE') {
                // Port already in use — assume an external server is serving dist
                server.close();
                return resolve(null);
            }
            return reject(err);
        };

        server.once('error', onError);

        server.listen(port, (err) => {
            server.removeListener('error', onError);
            if (err) return reject(err);
            resolve(server);
        });
    });
}

export default async function (globalConfig) {
    // Start an in-process static server serving dist/ on port 3000
    const root = path.join(process.cwd(), 'dist');
    // ensure dist exists
    if (!fs.existsSync(root)) {
        throw new Error('dist directory not found. Run build before tests.');
    }

    // store server on global so it can be closed in teardown if needed
    global.__staticServer = await createStaticServer(root, 3000);

    // Puppeteer environment: start browsers and set WS endpoints
    await setupPuppeteer(globalConfig);
};
