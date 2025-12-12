import { elementToLayer } from './element-to-figma';

// Expose a helper on window to convert a selector subtree to Layer JSON
// This file is included in the test/demo bundle.
declare global {
    interface Window {
        htmlToFigma?: any;
    }
}

window.htmlToFigma = window.htmlToFigma || {};

window.htmlToFigma.convert = async function (selector: string, options = {}) {
    const el = document.querySelector(selector);
    if (!el) throw new Error('selector not found: ' + selector);

    // elementToLayer should accept an Element and return a Layer JSON
    const layer = elementToLayer(el as Element, options);
    return layer;
};

export {};
