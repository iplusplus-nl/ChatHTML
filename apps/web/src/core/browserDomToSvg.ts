import { svgNamespace, xlinkNamespace } from "dom-to-svg/lib/dom.js";
import { createStackingLayers } from "dom-to-svg/lib/stacking.js";
import {
  walkNode,
  type DomToSvgOptions
} from "dom-to-svg/lib/traversal.js";
import { createIdGenerator } from "dom-to-svg/lib/util.js";

/**
 * Browser-safe subset of dom-to-svg's elementToSVG implementation.
 *
 * The package entrypoint eagerly imports PostCSS so it can rewrite @font-face
 * rules. That pulls Node compatibility shims into the browser bundle and
 * produces warnings for path, fs, url, and source-map. Screenshot capture only
 * needs the package's DOM traversal, which is browser-native, so keep that
 * traversal while omitting the optional font-rule copy.
 */
export function elementToBrowserSvg(
  element: Element,
  options?: DomToSvgOptions
): XMLDocument {
  const svgDocument = element.ownerDocument.implementation.createDocument(
    svgNamespace,
    "svg",
    null
  );
  const svgElement = svgDocument.documentElement as unknown as SVGSVGElement;
  const captureArea = options?.captureArea ?? element.getBoundingClientRect();

  svgElement.setAttribute("xmlns", svgNamespace);
  svgElement.setAttribute("xmlns:xlink", xlinkNamespace);

  walkNode(element, {
    svgDocument,
    currentSvgParent: svgElement,
    stackingLayers: createStackingLayers(svgElement),
    parentStackingLayer: svgElement,
    getUniqueId: createIdGenerator(),
    labels: new Map(),
    ancestorMasks: [],
    options: {
      captureArea,
      keepLinks: options?.keepLinks !== false
    }
  });

  svgElement.setAttribute("width", captureArea.width.toString());
  svgElement.setAttribute("height", captureArea.height.toString());
  svgElement.setAttribute(
    "viewBox",
    `${captureArea.x} ${captureArea.y} ${captureArea.width} ${captureArea.height}`
  );

  return svgDocument;
}
