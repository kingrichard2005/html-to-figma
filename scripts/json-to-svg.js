#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function colorToCss(c) {
    if (!c) return 'transparent';
    if (c.r !== undefined) {
        const r = Math.round(c.r * 255);
        const g = Math.round(c.g * 255);
        const b = Math.round(c.b * 255);
        return `rgb(${r},${g},${b})`;
    }
    return 'transparent';
}

function nodeToSvg(node) {
    const { type } = node;
    if (type === 'RECT') {
        const x = node.x || 0;
        const y = node.y || 0;
        const w = node.width || 0;
        const h = node.height || 0;
        const fill = (node.fills && node.fills[0] && node.fills[0].color) ? colorToCss(node.fills[0].color) : 'none';
        const stroke = (node.strokes && node.strokes[0] && node.strokes[0].color) ? colorToCss(node.strokes[0].color) : 'none';
        const strokeW = node.strokeWeight || 0;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
    }
    if (type === 'TEXT') {
        const x = node.x || 0;
        const y = node.y || 0;
        const text = node.characters ? node.characters.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
        const fill = (node.fills && node.fills[0] && node.fills[0].color) ? colorToCss(node.fills[0].color) : '#000';
        const fontSize = (node.fontSize) || 14;
        return `<text x="${x}" y="${y + fontSize}" fill="${fill}" font-size="${fontSize}">${text}</text>`;
    }
    // Container / Frame: render children
    if (node.children && node.children.length) {
        return node.children.map(nodeToSvg).join('\n');
    }
    return '';
}

function toSvg(root) {
    const width = root.width || 800;
    const height = root.height || 600;
    const content = nodeToSvg(root);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${content}\n</svg>`;
}

const argv = process.argv.slice(2);
if (argv.length < 2) {
    console.error('Usage: json-to-svg <in.json> <out.svg>');
    process.exit(2);
}
const inFile = path.resolve(argv[0]);
const outFile = path.resolve(argv[1]);
const raw = fs.readFileSync(inFile, 'utf8');
const json = JSON.parse(raw);
const svg = toSvg(json);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, svg, 'utf8');
console.log('Wrote', outFile);
