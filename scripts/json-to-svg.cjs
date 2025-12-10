#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function colorToCss(c) {
    if (!c) return 'transparent';
    if (c.r !== undefined) {
        const r = Math.round(c.r * 255);
        const g = Math.round(c.g * 255);
        const b = Math.round(c.b * 255);
        const a = c.a !== undefined ? c.a : 1;
        return `rgba(${r},${g},${b},${a})`;
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
        const fill = (node.fills && node.fills[0] && node.fills[0].color) ? colorToCss(node.fills[0].color) : (node.background || 'none');
        const stroke = (node.strokes && node.strokes[0] && node.strokes[0].color) ? colorToCss(node.strokes[0].color) : 'none';
        const strokeW = node.strokeWeight || 0;
        const opacity = node.opacity !== undefined ? node.opacity : (node.fills && node.fills[0] && node.fills[0].opacity !== undefined ? node.fills[0].opacity : 1);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" opacity="${opacity}" />`;
    }
    if (type === 'TEXT') {
        const x = node.x || 0;
        const y = node.y || 0;
        const text = node.characters ? node.characters.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '';
        const fill = (node.fills && node.fills[0] && node.fills[0].color) ? colorToCss(node.fills[0].color) : '#000';
        const fontSize = (node.fontSize) || 14;
        const opacity = node.opacity !== undefined ? node.opacity : 1;
        // Add simple font family mapping if present
        const font = node.fontName && node.fontName.family ? node.fontName.family : 'sans-serif';
        const baseline = node.baseline !== undefined ? node.baseline : (y + fontSize);
        return `<text x="${x}" y="${baseline}" fill="${fill}" font-size="${fontSize}" opacity="${opacity}" style="font-family: ${font};">${text}</text>`;
    }
    // Frame / Group: render as a <g> translated to x,y and render children inside
    if ((type === 'FRAME' || type === 'GROUP') && node.children && node.children.length) {
        const x = node.x || 0;
        const y = node.y || 0;
        const width = node.width || 0;
        const height = node.height || 0;
        const bg = node.background || (node.fills && node.fills[0] && node.fills[0].color ? colorToCss(node.fills[0].color) : null);
        const opacity = node.opacity !== undefined ? node.opacity : 1;
        let content = node.children.map(nodeToSvg).join('\n');
        // If background exists render a rect as the bottom-most layer
        if (bg && bg !== 'none' && bg !== 'transparent') {
            content = `<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}" opacity="${opacity}" />\n` + content;
        }
        const layoutAttr = node.layout ? ` data-layout='${JSON.stringify(node.layout)}'` : '';
        return `<g transform="translate(${x},${y})" opacity="${opacity}" data-name="${node.name || ''}"${layoutAttr}>\n${content}\n</g>`;
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
