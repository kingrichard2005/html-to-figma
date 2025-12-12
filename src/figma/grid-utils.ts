export function parseGridTemplate(spec: string | undefined, total: number, gapPx = 0) {
    if (!spec) return null;
    const parts = spec.trim().split(/\s+/);
    const cols: any[] = [];
    let fixed = 0;
    let frCount = 0;
    for (const p of parts) {
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
        const remain = Math.max(0, available - fixed);
        const perFr = remain / frCount;
        return cols.map((c) => (c.type === 'px' ? c.value : perFr * c.value));
    }
    return cols.map((c) => c.value);
}

export function assignChildrenToColumns(childInfo: { x: number; w: number; node?: any }[], colWidths: number[], layerX = 0, gapPx = 0) {
    // compute column left/right bounds
    const colBounds: { left: number; right: number }[] = [];
    let acc = 0;
    for (let i = 0; i < colWidths.length; i++) {
        const left = acc + i * gapPx;
        const right = left + colWidths[i];
        colBounds.push({ left, right });
        acc += colWidths[i];
    }

    const assigned: any[] = colWidths.map(() => []);
    childInfo.forEach((ci) => {
        const left = ci.x - Math.round(layerX);
        const right = left + ci.w;
        // find first column that intersects child
        let start = -1;
        let end = -1;
        for (let i = 0; i < colBounds.length; i++) {
            const b = colBounds[i];
            if (right > b.left && left < b.right) {
                if (start === -1) start = i;
                end = i;
            }
        }
        if (start === -1) {
            // fallback to nearest column by center
            const cx = left + Math.round(ci.w / 2);
            let acc2 = 0;
            for (let i = 0; i < colWidths.length; i++) {
                acc2 += colWidths[i];
                if (cx <= acc2) { start = end = i; break; }
            }
            if (start === -1) { start = end = colWidths.length - 1; }
        }
        assigned[start].push({ ci, span: end - start + 1, start, end });
    });
    return { assigned, colBounds };
}
