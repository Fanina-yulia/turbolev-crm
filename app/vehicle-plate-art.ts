const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const PLATE_VIEWBOX = "0 0 612 123";
export const PLATE_ASPECT_RATIO = 612 / 123;
export const PLATE_ART_VERSION = "svg-v1";

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPE[character]);
}

function plateGroups(display: string) {
  const compact = display.replace(/\s+/g, "");
  if (/^[A-Z]{2}\d{4}[A-Z]{2}$/.test(compact)) {
    return {
      left: compact.slice(0, 2),
      digits: compact.slice(2, 6),
      right: compact.slice(6, 8),
    };
  }
  return null;
}

/** Canonical scalable artwork based on the approved 612×123 reference raster. */
export function plateSvgMarkup(display: string) {
  const groups = plateGroups(display);
  const textStyle = `font-family="Arial Narrow, Nimbus Sans Narrow, Arial, sans-serif" font-size="106" font-weight="700" fill="#050505" stroke="#050505" stroke-width="0.8" stroke-linejoin="round" paint-order="stroke" style="font-family:'Arial Narrow','Nimbus Sans Narrow',Arial,sans-serif!important;font-size:106px!important;font-weight:700!important;fill:#050505!important;stroke:#050505!important"`;
  const numberMarkup = groups
    ? `<text x="66" y="101" textLength="129" lengthAdjust="spacingAndGlyphs" ${textStyle}>${escapeXml(groups.left)}</text><text x="215" y="101" textLength="202" lengthAdjust="spacingAndGlyphs" ${textStyle}>${escapeXml(groups.digits)}</text><text x="450" y="101" textLength="130" lengthAdjust="spacingAndGlyphs" ${textStyle}>${escapeXml(groups.right)}</text>`
    : `<text x="306" y="101" text-anchor="middle" textLength="470" lengthAdjust="spacingAndGlyphs" ${textStyle}>${escapeXml(display)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PLATE_VIEWBOX}" preserveAspectRatio="none" role="presentation" aria-hidden="true" data-plate-art="${PLATE_ART_VERSION}"><rect x="1.5" y="1.5" width="609" height="120" rx="5" fill="#fff" stroke="#0b0b0b" stroke-width="3"/><rect x="3" y="3" width="51" height="117" fill="#073b9b"/><rect x="12" y="31" width="33" height="14" fill="#f4d528"/><text x="28.5" y="112" text-anchor="middle" font-family="Arial, sans-serif" font-size="21" font-weight="700" fill="#fff" style="font-family:Arial,sans-serif!important;font-size:21px!important;font-weight:700!important;fill:#fff!important">UA</text>${numberMarkup}</svg>`;
}
