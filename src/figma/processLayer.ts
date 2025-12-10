import { getImageFills } from "../utils";
import { processImages } from "./images";
import { getMatchingFont } from "./getFont";
import { assign } from "./helpers";
import { LayerNode, PlainLayerNode, WithRef } from "../types";
import { parseGridTemplate, assignChildrenToColumns, parseGridTemplateAreas, buildAreaMap } from './grid-utils';

const processDefaultElement = (
    layer: LayerNode,
    node: SceneNode
): SceneNode => {
    node.x = layer.x as number;
    node.y = layer.y as number;
    node.resize(layer.width || 1, layer.height || 1);
    assign(node, layer);
    // rects.push(frame);
    return node;
};

const createNodeFromLayer = (layer: LayerNode) => {
    if (layer.type === 'FRAME' || layer.type === 'GROUP') {
        return figma.createFrame();
    }

    if (layer.type === 'SVG' && layer.svg) {
        return figma.createNodeFromSvg(layer.svg);
    }

    if (layer.type === 'RECTANGLE') {
        return figma.createRectangle();
    }

    if (layer.type === 'TEXT') {
        return figma.createText();
    }

    if (layer.type === 'COMPONENT') {
        return figma.createComponent();
    }
};

const SIMPLE_TYPES = ['FRAME', 'GROUP', 'SVG', 'RECTANGLE', 'COMPONENT'];

function applyPaddingToFrame(frameNode: FrameNode, layer: PlainLayerNode) {
    try {
        const pt = (layer as any).paddingTop || 0;
        const pr = (layer as any).paddingRight || 0;
        const pb = (layer as any).paddingBottom || 0;
        const pl = (layer as any).paddingLeft || 0;
        // Figma stores padding as paddingTop/Right/Bottom/Left
        frameNode.paddingTop = Math.round(pt);
        frameNode.paddingRight = Math.round(pr);
        frameNode.paddingBottom = Math.round(pb);
        frameNode.paddingLeft = Math.round(pl);
    } catch (e) {
        // ignore
    }
}

function convertGridToAutoLayout(parentFrame: FrameNode, node: SceneNode, layer: PlainLayerNode) {
    // Heuristic: group children by their rounded y positions to create rows
    const children = Array.from((node as FrameNode).children || []);
    if (!children.length) return;

    // Collect child x,y and widths and include any explicit grid row/col placements captured
    const childInfo = children.map((c) => ({
        node: c,
        x: Math.round(c.x),
        y: Math.round(c.y),
        w: Math.round(c.width),
        h: Math.round(c.height),
        // these properties may have been attached by element-to-figma
        gridRowStart: (c as any).gridRowStart,
        gridRowEnd: (c as any).gridRowEnd,
        gridRowSpan: (c as any).gridRowSpan,
        gridColumnStart: (c as any).gridColumnStart,
        gridColumnEnd: (c as any).gridColumnEnd,
        gridColumnSpan: (c as any).gridColumnSpan,
    }));

    // If any child has explicit row placement, create rows based on those indices
    const explicitRow = childInfo.some((ci) => typeof ci.gridRowStart === 'number' || typeof ci.gridRowSpan === 'number');
    let rows: any[] = [];
    if (explicitRow) {
        // group by declared row index (gridRowStart or compute from y fallback)
        const map = new Map();
        for (const ci of childInfo) {
            let rIdx = ci.gridRowStart;
            if (rIdx === undefined && typeof ci.gridRowSpan === 'number') {
                // no start provided, but span exists -> best-effort place in first row
                rIdx = 0;
            }
            if (rIdx === undefined) {
                // fallback to rounded y position grouping
                rIdx = Math.round(ci.y / (layer.height || 1));
            }
            const items = map.get(rIdx) || [];
            items.push(ci);
            map.set(rIdx, items);
        }
        const keys = Array.from(map.keys()).sort((a, b) => a - b);
        rows = keys.map((k) => ({ y: k, items: map.get(k) }));
    } else {
        // Heuristic: group children by their rounded y positions to create rows
        rows = [];
        const tolerance = 6; // px
        childInfo.forEach((ci) => {
            let placed = false;
            for (const r of rows) {
                if (Math.abs(r.y - ci.y) <= tolerance) {
                    r.items.push(ci);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                rows.push({ y: ci.y, items: [ci] });
            }
        });
    }

    if (rows.length <= 1) {
        // nothing to nest, leave as is
        return;
    }

    // If grid template exists, parse columns and assign children into column frames
    const layout = (layer as any).layout || {};
    const template = layout.template;
    const rowsTemplate = layout.rows;
    const areasSpec = layout.areas;
    const totalWidth = layer.width || (node as FrameNode).width || 0;

    const gapRaw = (layout && layout.gap) || (layer as any).gap || 0;
    const gapPx = typeof gapRaw === 'string' && gapRaw.endsWith('px') ? parseFloat(gapRaw) : parseFloat(gapRaw) || 0;
    const colWidths = parseGridTemplate(template, totalWidth, gapPx);
    // parse rows if provided
    const rowHeights = parseGridTemplate(rowsTemplate, (layer.height || (node as FrameNode).height || 0), gapPx);
    // parse areas spec
    const areas = parseGridTemplateAreas(areasSpec);
    const areaMap = buildAreaMap(areas);
    if (areaMap) {
        // create grid of frames matching areaMap: rows x cols
        const numCols = areas && areas[0] ? areas[0].length : (colWidths ? colWidths.length : 0);
        const numRows = areas ? areas.length : (rowHeights ? rowHeights.length : 0);
        // wrapper as grid container
        const wrapper = figma.createFrame();
        wrapper.layoutMode = 'VERTICAL';
        wrapper.primaryAxisSizingMode = 'AUTO';
        wrapper.counterAxisSizingMode = 'FIXED';

        // create row frames
        const rowFrames: FrameNode[] = [];
        for (let r = 0; r < numRows; r++) {
            const rowFrame = figma.createFrame();
            rowFrame.layoutMode = 'HORIZONTAL';
            rowFrame.primaryAxisSizingMode = 'AUTO';
            rowFrame.counterAxisSizingMode = 'FIXED';
            wrapper.appendChild(rowFrame);
            rowFrames.push(rowFrame);
        }

        // create column placeholder frames inside each row with widths
        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) {
                const col = figma.createFrame();
                col.layoutMode = 'VERTICAL';
                col.primaryAxisSizingMode = 'AUTO';
                col.counterAxisSizingMode = 'FIXED';
                const w = colWidths && colWidths[c] ? Math.round(colWidths[c]) : Math.round((totalWidth / numCols) || 0);
                col.resize(w, Math.round(layer.height || (node as FrameNode).height || 0));
                rowFrames[r].appendChild(col);
            }
        }

        // Place children by gridArea name if present, else by coordinate mapping via areaMap
        childInfo.forEach((ci) => {
            const nodeAreaName = (ci.node as any).gridArea || (ci as any).gridArea;
            if (nodeAreaName && areaMap && areaMap[nodeAreaName]) {
                const m = areaMap[nodeAreaName];
                const targetRow = m.rowStart;
                const targetCol = m.colStart;
                // compute span widths and heights
                const spanCols = m.colEnd - m.colStart + 1;
                const spanRows = m.rowEnd - m.rowStart + 1;
                const spanWidth = (colWidths && colWidths.slice(targetCol, targetCol + spanCols).reduce((s: number, v: number) => s + v, 0)) || 0;
                const spanHeight = (rowHeights && rowHeights.slice(targetRow, targetRow + spanRows).reduce((s: number, v: number) => s + v, 0)) || 0;
                const totalGapWidth = gapPx * Math.max(0, spanCols - 1);
                const totalGapHeight = gapPx * Math.max(0, spanRows - 1);
                try { ci.node.remove(); } catch (e) {}
                // resize node to cover span (add gaps)
                try { ci.node.resize(Math.round(spanWidth + totalGapWidth), Math.round(spanHeight + totalGapHeight)); } catch (e) {}
                // append to top-left cell
                rowFrames[targetRow].children[targetCol].appendChild(ci.node);
            }
        });

        try {
            const origChildren = Array.from((node as FrameNode).children || []);
            origChildren.forEach((c) => { try { c.remove(); } catch (e) {} });
            (node as FrameNode).appendChild(wrapper);
        } catch (e) {
            console.warn('Grid areas conversion failed', e);
        }

        return;
    }
    if (colWidths && colWidths.length > 1) {
        // create wrapper with HORIZONTAL layout representing columns
        const wrapper = figma.createFrame();
        wrapper.layoutMode = 'HORIZONTAL';
        wrapper.primaryAxisSizingMode = 'AUTO';
        wrapper.counterAxisSizingMode = 'FIXED';
        // create column frames according to widths
        const columns = colWidths.map((w: number) => {
            const col = figma.createFrame();
            col.layoutMode = 'VERTICAL';
            col.primaryAxisSizingMode = 'AUTO';
            col.counterAxisSizingMode = 'FIXED';
            // set fixed width for column frame
            col.resize(Math.round(w), Math.round(layer.height || (node as FrameNode).height || 0));
            wrapper.appendChild(col);
            return col;
        });

        const { assigned } = assignChildrenToColumns(childInfo, colWidths, layer.x || (node as FrameNode).x || 0, gapPx);
        assigned.forEach((items: any[], i: number) => {
            items.sort((a: any, b: any) => a.ci.y - b.ci.y).forEach((entry: any) => {
                const ci = entry.ci;
                const span = entry.span || 1;
                try { ci.node.remove(); } catch (e) {}
                // if span > 1, resize node to cover span width
                if (span > 1) {
                    const spanWidth = colWidths.slice(i, i + span).reduce((s, v) => s + v, 0) + gapPx * (span - 1);
                    try { ci.node.resize(Math.round(spanWidth), ci.node.height); } catch (e) {}
                }
                columns[i].appendChild(ci.node);
            });
        });

        // replace original children with wrapper
        try {
            const origChildren = Array.from((node as FrameNode).children || []);
            origChildren.forEach((c) => { try { c.remove(); } catch (e) {} });
            (node as FrameNode).appendChild(wrapper);
        } catch (e) {
            console.warn('Grid templating conversion failed', e);
        }

        return;
    }

    // replace original node children with wrapper
    try {
        // remove all children from original node
        const origChildren = Array.from((node as FrameNode).children || []);
        origChildren.forEach((c) => { try { c.remove(); } catch (e) {} });
        (node as FrameNode).appendChild(wrapper);
    } catch (e) {
        console.warn('Grid conversion failed', e);
    }
}

export const processLayer = async (
    layer: PlainLayerNode,
    parent: WithRef<LayerNode> | null,
    baseFrame: PageNode | FrameNode
) => {
    const parentFrame = (parent?.ref as FrameNode) || baseFrame;

    if (typeof layer.x !== 'number' || typeof layer.y !== 'number') {
        throw Error('Layer coords not defined');
    }

    const node = createNodeFromLayer(layer);

    if (!node) {
        throw Error(`${layer.type} not implemented`);
    }

    if (SIMPLE_TYPES.includes(layer.type as string)) {
        // If layout metadata exists, configure Auto Layout on frame nodes
        if ((layer.type === 'FRAME' || layer.type === 'GROUP') && (layer as any).layout) {
            const meta = (layer as any).layout;
            const frameNode = node as FrameNode;
            // apply padding if present
            applyPaddingToFrame(frameNode, layer);
            // default padding and sizing can be refined later
            if (meta.type === 'flex') {
                // map flex direction
                frameNode.layoutMode = meta.direction === 'column' ? 'VERTICAL' : 'HORIZONTAL';
                // spacing between items
                if (typeof meta.gap === 'number' && !isNaN(meta.gap)) {
                    frameNode.itemSpacing = Math.round(meta.gap);
                }
                // align items -> counterAxisAlignItems
                if (meta.align) {
                    // alignItems: 'flex-start' | 'center' | 'flex-end'
                    if (meta.align.includes('center')) frameNode.counterAxisAlignItems = 'CENTER';
                    else if (meta.align.includes('end')) frameNode.counterAxisAlignItems = 'MAX';
                    else frameNode.counterAxisAlignItems = 'MIN';
                }
                // justify -> primary axis alignment mapping
                if (meta.justify) {
                    if (meta.justify.includes('center')) frameNode.primaryAxisAlignItems = 'CENTER';
                    else if (meta.justify.includes('space-between')) frameNode.primaryAxisAlignItems = 'SPACE_BETWEEN';
                    else if (meta.justify.includes('end')) frameNode.primaryAxisAlignItems = 'MAX';
                    else frameNode.primaryAxisAlignItems = 'MIN';
                }
                // sizing defaults: hug contents on primary axis
                frameNode.primaryAxisSizingMode = 'AUTO';
                frameNode.counterAxisSizingMode = 'FIXED';
            }
            if (meta.type === 'grid') {
                // Figma has no direct 'grid' auto-layout mapping; approximate with VERTICAL mode
                const frameNode = node as FrameNode;
                frameNode.layoutMode = 'VERTICAL';
                frameNode.primaryAxisSizingMode = 'AUTO';
                frameNode.counterAxisSizingMode = 'FIXED';
                // attempt to convert grid into nested auto-layout rows
                try {
                    convertGridToAutoLayout(parentFrame as FrameNode, node, layer as PlainLayerNode);
                } catch (e) {
                    // ignore conversion failures
                }
            }
        }

        parentFrame.appendChild(processDefaultElement(layer, node));
    }
    // @ts-expect-error
    // attach reference and propagate any placement metadata from layer to created node
    // @ts-expect-error
    layer.ref = node;
    try {
        if ((layer as any).gridRowStart !== undefined) (node as any).gridRowStart = (layer as any).gridRowStart;
        if ((layer as any).gridRowEnd !== undefined) (node as any).gridRowEnd = (layer as any).gridRowEnd;
        if ((layer as any).gridRowSpan !== undefined) (node as any).gridRowSpan = (layer as any).gridRowSpan;
        if ((layer as any).gridColumnStart !== undefined) (node as any).gridColumnStart = (layer as any).gridColumnStart;
        if ((layer as any).gridColumnEnd !== undefined) (node as any).gridColumnEnd = (layer as any).gridColumnEnd;
        if ((layer as any).gridColumnSpan !== undefined) (node as any).gridColumnSpan = (layer as any).gridColumnSpan;
    } catch (e) {}

    if (layer.type === 'RECTANGLE') {
        if (getImageFills(layer as RectangleNode)) {
            await processImages(layer as RectangleNode);
        }
    }

    if (layer.type === 'TEXT') {
        const text = node as TextNode;

        if (layer.fontFamily) {
            text.fontName = await getMatchingFont(layer.fontFamily);

            delete layer.fontFamily;
        }

        assign(text, layer);
        text.resize(layer.width || 1, layer.height || 1);

        text.textAutoResize = 'HEIGHT';
        
        let adjustments = 0;
        if (layer.lineHeight) {
            text.lineHeight = layer.lineHeight;
        }
        // Adjust text width
        while (
            typeof layer.height === 'number' &&
            text.height > layer.height
        ) {

            if (adjustments++ > 5) {
                console.warn('Too many font adjustments', text, layer);

                break;
            }

            try {
                text.resize(text.width + 1, text.height);
            } catch (err) {
                console.warn('Error on resize text:', layer, text, err);
            }
        }

        parentFrame.appendChild(text);
    }

    return node;
};
