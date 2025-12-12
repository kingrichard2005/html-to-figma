#!/usr/bin/env node
import puppeteer from 'puppeteer';
import http from 'http';
import path from 'path';
import fs from 'fs';
import * as urlLib from 'url';

// Minimal demo script used by tests and CI. Launches Puppeteer with
// CI-friendly flags and serves the dist/ directory when no --url is
// provided.

const argv = process.argv.slice(2);
let url = null;
let selector = 'body';
let outJson = 'out/layer.json';
let outSvg = 'out/layer.svg';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') url = argv[++i];
  else if (a === '--selector') selector = argv[++i];
  else if (a === '--out') { outJson = argv[++i]; outSvg = outJson.replace(/\.json$/, '.svg'); }
}

function startStatic(dir, port = 0) {
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const parsed = urlLib.parse(req.url || '/');
        let pathname = decodeURIComponent(parsed.pathname || '/');
        if (pathname === '/') pathname = '/index.html';
        const filePath = path.join(dir, pathname);
        if (!filePath.startsWith(path.join(dir, path.sep))) { res.statusCode = 403; res.end('Forbidden'); return; }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
          fs.createReadStream(filePath).pipe(res);
        } else {
          const idx = path.join(filePath, 'index.html');
          if (fs.existsSync(idx)) { res.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(idx).pipe(res); }
          else { res.statusCode = 404; res.end('Not found'); }
        }
      } catch (e) { res.statusCode = 500; res.end('Server error'); }
    }).listen(port, () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  let server = null;
  let pageUrl = url;
  if (!pageUrl) {
    const distDir = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distDir)) { console.error('dist/ not found, run npm run build:tests first'); process.exit(1); }
    const srv = await startStatic(distDir, 0);
    server = srv.server;

    // Prefer index.html, but if it's not present use the first HTML under dist/stubs/*
    const indexPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      pageUrl = `http://localhost:${srv.port}/index.html`;
    } else {
      // find first HTML file under dist/stubs
      const stubsDir = path.join(distDir, 'stubs');
      let found = null;
      if (fs.existsSync(stubsDir)) {
        const walk = (dir) => {
          for (const f of fs.readdirSync(dir)) {
            const fp = path.join(dir, f);
            const stat = fs.statSync(fp);
            if (stat.isDirectory()) {
              const res = walk(fp);
              if (res) return res;
            } else if (f.toLowerCase().endsWith('.html')) {
              return path.relative(distDir, fp).replace(/\\/g, '/');
            }
          }
          return null;
        };
        found = walk(stubsDir);
      }
      if (found) pageUrl = `http://localhost:${srv.port}/${found}`;
      else { console.error('no index.html or stubs found in dist/ — run npm run build:tests'); process.exit(1); }
    }
  }

  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  const browser = await puppeteer.launch({ headless: true, args: launchArgs });
  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'networkidle0' });

  // Ensure htmlToFigma is available by injecting the built bundle if present.
  const bundlePath = path.join(process.cwd(), 'dist', 'index.js');
  if (fs.existsSync(bundlePath)) {
    try { await page.addScriptTag({ path: bundlePath }); } catch (e) { /* ignore */ }
  }

  const layer = await page.evaluate(async (sel) => {
    // Support both the exported helper used in tests (`window.__htmlToFigma = htmlToFigma`)
    // and the runtime helper (`window.htmlToFigma.convert`). Handle both function
    // exports and object-with-convert signatures.
    const api = window.htmlToFigma || window.__htmlToFigma;
    if (!api) throw new Error('htmlToFigma.convert not available on page');
    if (typeof api === 'function') {
      return await api(sel);
    }
    if (api && typeof api.convert === 'function') {
      return await api.convert(sel, { snapshot: true });
    }
    throw new Error('htmlToFigma.convert not available on page');
  }, selector);

  await browser.close(); if (server) server.close();

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(layer, null, 2), 'utf8');

  try {
    const { execSync } = await import('child_process');
    const script = path.join(process.cwd(), 'scripts', 'json-to-svg.cjs');
    execSync(`node "${script}" "${outJson}" "${outSvg}"`, { stdio: 'inherit' });
  } catch (e) { /* ignore svg generation failures in CI */ }

  process.exit(0);
  })();
