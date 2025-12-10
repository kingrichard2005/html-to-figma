function parseGridTemplate(spec, total, gapPx = 0) {
    if (!spec) return null;
    // attempt to expand repeat(auto-fill/auto-fit) and handle minmax
    let s = String(spec).trim();
    // expand repeat(auto-fill|auto-fit, <track>) by estimating how many tracks fit in `total`
    const repeatRe = /repeat\s*\(\s*(auto-fill|auto-fit)\s*,\s*([^\)]+)\)/i;
    let mRepeat = s.match(repeatRe);
    if (mRepeat) {
        const inner = mRepeat[2].trim();
        // parse inner to compute single-track minimum width if minmax or px present
        const singleParts = inner.split(/\s+/);
        // compute minimal track width (best-effort)
        let minTrack = 0;
        for (const p of singleParts) {
            const mMin = p.match(/minmax\(([^,]+),([^\)]+)\)/i);
            if (mMin) {
                // use the min side for sizing
                const minVal = mMin[1].trim();
                if (minVal.endsWith('px')) minTrack += parseFloat(minVal);
                else if (minVal.endsWith('%')) minTrack += (parseFloat(minVal) / 100) * total;
                else minTrack += 0;
            } else if (p.endsWith('px')) {
                minTrack += parseFloat(p);
            } else if (p.endsWith('%')) {
                minTrack += (parseFloat(p) / 100) * total;
            } else if (p.endsWith('fr')) {
                // fr is flexible; assume 100px baseline per fr for estimate
                minTrack += 100 * (parseFloat(p) || 1);
            }
        }
        const estimatedCount = Math.max(1, Math.floor((total + 1e-6) / (minTrack + 0)));
        // repeat inner estimatedCount times
        const reps = new Array(estimatedCount).fill(inner).join(' ');
        s = s.replace(mRepeat[0], reps);
        // re-evaluate in case nested repeats
        mRepeat = s.match(repeatRe);
    }
    // tokenize tracks but keep parenthesized groups intact (so minmax(...) stays one token)
    const parts = [];
    let buf = '';
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') { depth++; buf += ch; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; continue; }
        if (depth === 0 && /\s/.test(ch)) {
            if (buf.trim()) { parts.push(buf.trim()); buf = ''; }
            continue;
        }
        buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    const cols = [];
    let fixed = 0;
    let frCount = 0;
    for (const pRaw of parts) {
        const p = pRaw.trim();
        if (!p) continue;
        const mMinMax = p.match(/minmax\(([^,]+),([^\)]+)\)/i);
        if (mMinMax) {
            const minSide = mMinMax[1].trim();
            const maxSide = mMinMax[2].trim();
            // If max is fr and min is px, decide based on available per-track after fixed sizing
            if (minSide.endsWith('px') && maxSide.endsWith('fr')) {
                const minPx = parseFloat(minSide);
                // temporarily push as min, decision refined below in fr handling
                cols.push({ type: 'px', value: minPx, minmax: true, maxFr: parseFloat(maxSide) || 1 });
                fixed += minPx;
                continue;
            }
            // fallback: if min is px use that, else fall back to px 0
            if (minSide.endsWith('px')) {
                const v = parseFloat(minSide);
                cols.push({ type: 'px', value: v });
                fixed += v;
                continue;
            }
            // other cases fallthrough
        }
        if (p.endsWith('px')) {
            const v = parseFloat(p);
            cols.push({ type: 'px', value: v });
            fixed += v;
        } else if (p.endsWith('%')) {
            const pct = parseFloat(p) / 100;
            const v = pct * total;
            cols.push({ type: 'px', value: v });
            fixed += v;
        } else if (p.endsWith('fr')) {
            const f = parseFloat(p) || 1;
            cols.push({ type: 'fr', value: f });
            frCount += f;
        } else {
            const v = parseFloat(p) || 0;
            cols.push({ type: 'px', value: v });
            fixed += v;
        }
    }
    const count = cols.length;
    const totalGap = Math.max(0, (count - 1) * gapPx);
    const available = Math.max(0, total - totalGap);
    if (frCount > 0) {
        // if some cols were minmax with stored maxFr, check per-fr available space
        const remain = Math.max(0, available - fixed);
        const perFr = remain / frCount;
        return cols.map((c) => {
            if (c.type === 'px') return c.value;
            // if this px entry had minmax metadata, prefer min if perFr * maxFr < min
            if (c.minmax && c.maxFr) {
                const maxCandidate = perFr * c.maxFr;
                if (maxCandidate < c.value) {
                    return c.value; // use min
                }
                return maxCandidate;
            }
            return perFr * c.value;
        });
    }
    return cols.map((c) => c.value);
}

function parseGridTemplateAreas(spec) {
    if (!spec) return null;
    // CSS grid-template-areas is a string like: "'a a b' 'c d b'"
    // Normalize and extract rows of names
    const rows = [];
    // remove surrounding quotes and split on quotes groups
    const matches = String(spec).match(/'[^']+'|"[^"]+"/g);
    if (!matches) return null;
    for (const m of matches) {
        const row = m.replace(/['"]/g, '').trim().split(/\s+/);
        rows.push(row);
    }
    return rows;
}

function buildAreaMap(areas) {
    if (!areas || !areas.length) return null;
    const map = {};
    for (let r = 0; r < areas.length; r++) {
        const row = areas[r];
        for (let c = 0; c < row.length; c++) {
            const name = row[c];
            if (!name || name === '.') continue;
            if (!map[name]) {
                map[name] = { rowStart: r, rowEnd: r, colStart: c, colEnd: c };
            } else {
                map[name].rowStart = Math.min(map[name].rowStart, r);
                map[name].rowEnd = Math.max(map[name].rowEnd, r);
                map[name].colStart = Math.min(map[name].colStart, c);
                map[name].colEnd = Math.max(map[name].colEnd, c);
            }
        }
    }
    return map;
}

function assignChildrenToColumns(childInfo, colWidths, layerX = 0, gapPx = 0) {
    // compute column left/right bounds
    const colBounds = [];
    let acc = 0;
    for (let i = 0; i < colWidths.length; i++) {
        const left = Math.round(acc + i * gapPx) + Math.round(layerX ? 0 : 0);
        const right = left + Math.round(colWidths[i]);
        colBounds.push({ left, right });
        acc += colWidths[i];
    }

    const assigned = colWidths.map(() => []);
    childInfo.forEach((ci) => {
        // If explicit placement is provided on the child, honor it
        const explicitStart = typeof ci.gridColumnStart === 'number' ? ci.gridColumnStart : (typeof ci.gridColumn === 'number' ? ci.gridColumn : undefined);
        const explicitEnd = typeof ci.gridColumnEnd === 'number' ? ci.gridColumnEnd : (typeof ci.gridColumnSpan === 'number' && explicitStart !== undefined ? explicitStart + ci.gridColumnSpan - 1 : undefined);

        let start = -1;
        let end = -1;

        if (explicitStart !== undefined && explicitStart >= 0 && explicitStart < colWidths.length) {
            start = explicitStart;
            if (explicitEnd !== undefined) {
                end = Math.min(colWidths.length - 1, explicitEnd);
            } else {
                end = start;
            }
        } else {
            const left = Math.round(ci.x - Math.round(layerX));
            const right = left + Math.round(ci.w);
            for (let i = 0; i < colBounds.length; i++) {
                const b = colBounds[i];
                if (right > b.left && left < b.right) {
                    if (start === -1) start = i;
                    end = i;
                }
            }
            if (start === -1) {
                const cx = left + Math.round(ci.w / 2);
                let acc2 = 0;
                for (let i = 0; i < colWidths.length; i++) {
                    acc2 += colWidths[i];
                    if (cx <= acc2) { start = end = i; break; }
                }
                if (start === -1) { start = end = colWidths.length - 1; }
            }
        }

        const span = Math.max(1, end - start + 1);
        assigned[start].push({ ci, span, start, end });
    });
    return { assigned, colBounds };
}

module.exports = { parseGridTemplate, assignChildrenToColumns, parseGridTemplateAreas, buildAreaMap };
