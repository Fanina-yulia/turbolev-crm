import { type PDFPage, rgb } from "pdf-lib";

const BODY = rgb(0.16, 0.18, 0.21);
const GLASS = rgb(0.72, 0.76, 0.80);
const ACCENT = rgb(0.94, 0.29, 0.14);

/** Draws a neutral, badge-free vehicle when the model image is not ready. */
export function drawNeutralVehicle(page: PDFPage, x: number, y: number, width: number, height: number) {
  const scale = width / 180;
  const top = y + height;
  page.drawSvgPath(
    "M19 53c3-9 9-15 18-17l20-5 14-15c4-4 9-6 15-6h33c7 0 12 2 17 7l13 14 15 4c8 2 13 8 14 16l1 8h-14a16 16 0 0 1-31 0H57a16 16 0 0 1-31 0H15l4-6Z",
    { x, y: top, scale, color: BODY },
  );
  page.drawSvgPath(
    "M65 31l12-13c2-2 5-3 9-3h13v16H65Zm40 0V15h14c4 0 7 1 10 4l11 12h-35Z",
    { x, y: top, scale, color: GLASS },
  );
  page.drawCircle({ x: x + 42 * scale, y: y + 23 * scale, size: 10 * scale, color: rgb(0.06, 0.07, 0.08) });
  page.drawCircle({ x: x + 149 * scale, y: y + 23 * scale, size: 10 * scale, color: rgb(0.06, 0.07, 0.08) });
  page.drawLine({
    start: { x: x + 24 * scale, y: y + 50 * scale },
    end: { x: x + 158 * scale, y: y + 50 * scale },
    thickness: Math.max(0.8, 1.4 * scale),
    color: ACCENT,
    opacity: 0.85,
  });
}
