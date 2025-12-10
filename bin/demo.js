#!/usr/bin/env node
import puppeteer from 'puppeteer';
import http from 'http';
import path from 'path';
import fs from 'fs';
import * as urlLib from 'url';

const argv = process.argv.slice(2);
let url = null;
let selector = 'body';
let outJson = 'out/layer.json';
let outSvg = 'out/layer.svg';
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') { url = argv[++i]; }
    else if (a === '--selector') { selector = argv[++i]; }
    else if (a === '--out') { outJson = argv[++i]; outSvg = outJson.replace(/\.json$/, '.svg'); }
}

// sanitize selector if wrapped in quotes
if (selector && ((selector.startsWith("'") && selector.endsWith("'")) || (selector.startsWith('"') && selector.endsWith('"')))) {
    selector = selector.slice(1, -1);
}

async function startStatic(dir, port=0) {
    const mime = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
    };
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            try {
                const parsed = urlLib.parse(req.url || '/');
                let pathname = decodeURIComponent(parsed.pathname || '/');
                if (pathname === '/') pathname = '/index.html';
                const filePath = path.join(dir, pathname);
                if (!filePath.startsWith(path.join(dir, path.sep))) {
                    res.statusCode = 403;
                    res.end('Forbidden');
                    return;
                }
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    const ext = path.extname(filePath).toLowerCase();
                    const type = mime[ext] || 'application/octet-stream';
                    res.writeHead(200, { 'Content-Type': type });
                    fs.createReadStream(filePath).pipe(res);
                } else {
                    // try index.html in directory
                    const idx = path.join(filePath, 'index.html');
                    if (fs.existsSync(idx)) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        fs.createReadStream(idx).pipe(res);
                    } else {
                        res.statusCode = 404;
                        res.end('Not found');
                    }
                }
            } catch (e) {
                res.statusCode = 500;
                res.end('Server error');
            }
        }).listen(port, () => {
            const address = server.address();
            let usedPort = port;
            if (address && typeof address === 'object' && address.port) usedPort = address.port;
            resolve({ server, port: usedPort });
        });
    });
}

(async () => {
    let server = null;
    let pageUrl = url;
    if (!pageUrl) {
        // build tests if needed
        console.log('No url provided — serving dist/');
        const distDir = path.join(process.cwd(), 'dist');
        if (!fs.existsSync(distDir)) {
            console.error('dist/ not found, run npm run build:tests first');
            process.exit(1);
        }
        const srv = await startStatic(distDir, 0);
        server = srv.server;
        // prefer an index.html, otherwise a test stub
        const base = `http://localhost:${srv.port}`;
        const tryIndex = `${base}/index.html`;
        const stub = `${base}/stubs/base-button.html`;
        pageUrl = tryIndex;
        // check if index exists by probing the file system
        const idxPath = path.join(process.cwd(), 'dist', 'index.html');
        const stubPath = path.join(process.cwd(), 'dist', 'stubs', 'base-button.html');
        if (!fs.existsSync(idxPath) && fs.existsSync(stubPath)) {
            pageUrl = stub;
        }
    }

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });
    console.log('Loaded', pageUrl);

    // inject built bundle if available so htmlToFigma is exposed in the page
    const bundlePath = path.join(process.cwd(), 'dist', 'index.js');
    if (fs.existsSync(bundlePath)) {
        try {
            await page.addScriptTag({ path: bundlePath });
            console.log('Injected bundle', bundlePath);
        } catch (e) {
            console.warn('Failed to inject bundle', e);
        }
    }

    // Provide a small fallback convert function if the library is not present.
    await page.evaluate(() => {
        try {
            if (window.htmlToFigma && window.htmlToFigma.convert) return;
        } catch (e) {}
        window.htmlToFigma = {
            convert: (sel, opts) => {
                const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
                if (!el) return null;
                function nodeToLayer(node) {
                    const rect = node.getBoundingClientRect();
                    const style = window.getComputedStyle(node);
                    const layer = {
                        type: 'FRAME',
                        name: node.tagName.toLowerCase(),
                        x: Math.round(rect.left),
                        y: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        background: style.backgroundColor || null,
                        children: []
                    };
                    if (node.childNodes && node.childNodes.length) {
                        node.childNodes.forEach((c) => {
                            if (c.nodeType === Node.TEXT_NODE && c.textContent && c.textContent.trim()) {
                                layer.children.push({ type: 'TEXT', text: c.textContent.trim(), x: layer.x, y: layer.y });
                            } else if (c.nodeType === Node.ELEMENT_NODE) {
                                layer.children.push(nodeToLayer(c));
                            }
                        });
                    }
                    return layer;
                }
                return nodeToLayer(el);
            }
        };
    });

    const layer = await page.evaluate(async (sel) => {
        // @ts-ignore
        if (!window.htmlToFigma || !window.htmlToFigma.convert) throw new Error('htmlToFigma.convert not available on page');
        return await window.htmlToFigma.convert(sel, { snapshot: true });
    }, selector);

    await browser.close();
    if (server) server.close();

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.writeFileSync(outJson, JSON.stringify(layer, null, 2), 'utf8');
    console.log('Wrote', outJson);

    // convert to svg using script
    const { execSync } = await import('child_process');
    try {
        const script = path.join(process.cwd(), 'scripts', 'json-to-svg.cjs');
        execSync(`node "${script}" "${outJson}" "${outSvg}"`, { stdio: 'inherit' });
        console.log('Wrote', outSvg);
    } catch (e) {
        console.error('Failed to create SVG', e);
    }

    process.exit(0);
})();
