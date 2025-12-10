const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Demo CLI', () => {
    const outJson = path.resolve('out/test.json');
    const outSvg = path.resolve('out/test.svg');

    beforeAll(() => {
        // require that `dist/` exists (build:tests should be run by CI or locally)
        if (!fs.existsSync(path.join(process.cwd(), 'dist'))) {
            throw new Error('dist/ not found — run `npm run build:tests` before running tests');
        }
    });

    it('generates svg with layout or text', () => {
        // run demo CLI using spawnSync to avoid shell quoting issues
        const { spawnSync } = require('child_process');
        const res = spawnSync('node', ['./bin/demo.js', '--selector', '#container', '--out', outJson], { stdio: 'inherit' });
        if (res.error) throw res.error;
        if (res.status !== 0) throw new Error('demo CLI failed with status ' + res.status);

        expect(fs.existsSync(outJson)).toBe(true);
        expect(fs.existsSync(outSvg)).toBe(true);

        const svg = fs.readFileSync(outSvg, 'utf8');
        // expect either layout metadata or at least a text element
        const hasGroup = /<g[^>]*data-layout=/.test(svg);
        const hasText = /<text[^>]*>/.test(svg);

        expect(hasGroup || hasText).toBe(true);
    }, 300000);
});
