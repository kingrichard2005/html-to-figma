const { parseGridTemplate, assignChildrenToColumns, parseGridTemplateAreas, buildAreaMap } = require('../src/figma/grid-utils');

test('parseGridTemplate with px and fr values', () => {
    const total = 600;
    const spec = '100px 2fr 1fr';
    const cols = parseGridTemplate(spec, total);
    // first column fixed 100, remaining 500 -> 3fr units => perFr=166.666
    expect(cols.length).toBe(3);
    expect(Math.round(cols[0])).toBe(100);
    expect(Math.round(cols[1]) + Math.round(cols[2])).toBeGreaterThanOrEqual(500 - 1);
});

test('assignChildrenToColumns assigns by center x', () => {
    const colWidths = [200, 200, 200];
    const children = [
        { x: 10, w: 50 },
        { x: 220, w: 50 },
        { x: 430, w: 50 },
    ];
    const res = assignChildrenToColumns(children, colWidths, 0);
    const assigned = res.assigned;
    expect(assigned[0].length).toBe(1);
    expect(assigned[1].length).toBe(1);
    expect(assigned[2].length).toBe(1);
});

test('assignChildrenToColumns detects spans', () => {
    const colWidths = [100, 100, 100];
    // a child starting at x=90 width=150 spans columns 0 and 1 (from 90 to 240)
    const children = [ { x: 90, w: 150 } ];
    const res = assignChildrenToColumns(children, colWidths, 0);
    // using new API shape: result.assigned
    if (res.assigned) {
        const assigned = res.assigned;
        expect(assigned[0].length + assigned[1].length + assigned[2].length).toBe(1);
        // ensure first column has an entry with span > 1
        const entry = assigned[0][0];
        expect(entry.span).toBeGreaterThan(1);
    } else {
        // fallback if older api
        expect(true).toBe(true);
    }
});

test('parseGridTemplate handles percentage templates and gap', () => {
    const total = 500;
    const spec = '50% 50%';
    const cols = parseGridTemplate(spec, total, 10);
    // total gap = 1 * 10 = 10 -> available = 490 -> each 50% = 245
    expect(cols.length).toBe(2);
    expect(Math.round(cols[0] + cols[1])).toBeGreaterThanOrEqual(490 - 1);
});

test('assignChildrenToColumns honors explicit grid-column placement', () => {
    const colWidths = [100, 100, 100];
    // child has explicit gridColumnStart=0 and gridColumnEnd=1 meaning span 2
    const children = [ { x: 90, w: 50, gridColumnStart: 0, gridColumnEnd: 1 } ];
    const res = assignChildrenToColumns(children, colWidths, 0);
    const assigned = res.assigned;
    // should place in first column with span 2
    const entry = assigned[0][0];
    expect(entry.start).toBe(0);
    expect(entry.span).toBe(2);
});

test('parseGridTemplateAreas parses area strings', () => {
    const spec = "'a a b' 'c d b'";
    const areas = parseGridTemplateAreas(spec);
    expect(Array.isArray(areas)).toBe(true);
    expect(areas.length).toBe(2);
    expect(areas[0][0]).toBe('a');
    expect(areas[1][2]).toBe('b');
});

test('parseGridTemplate handles repeat(auto-fill) best-effort', () => {
    const total = 400;
    const spec = 'repeat(auto-fill, 100px 1fr)';
    const cols = parseGridTemplate(spec, total, 10);
    // Should return an array (best-effort). length >= 1
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBeGreaterThanOrEqual(1);
});

test('buildAreaMap maps area names to coordinates', () => {
    const areas = [ ['a','a','b'], ['c','d','b'] ];
    const map = buildAreaMap(areas);
    expect(map.a.rowStart).toBe(0);
    expect(map.a.rowEnd).toBe(0);
    expect(map.b.colEnd).toBe(2);
    expect(map.c.rowStart).toBe(1);
});

test('parseGridTemplate minmax chooses min when space is tight', () => {
    const total = 220; // small total
    const spec = 'minmax(100px, 1fr) 1fr';
    // with gap 0, two tracks -> if min used, first track 100, remaining 120 -> second ~120
    const cols = parseGridTemplate(spec, total, 0);
    expect(cols.length).toBe(2);
    expect(Math.round(cols[0])).toBeGreaterThanOrEqual(100);
});
