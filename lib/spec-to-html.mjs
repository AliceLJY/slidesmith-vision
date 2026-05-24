import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readSpec(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export function specToHtml(spec, options = {}) {
  const canvasWidth = Number(spec.canvas_width || 1920);
  const canvasHeight = Number(spec.canvas_height || 1080);
  const slides = Array.isArray(spec.slides) ? spec.slides : [];
  const title = options.title || 'SlideSmith Vision';
  const baseDir = options.baseDir || process.cwd();

  const slideHtml = slides.map((slide) => {
    const background = slide.background || spec.background || '#ffffff';
    const elements = (slide.elements || []).map((element) =>
      renderElement(element, { canvasWidth, canvasHeight, baseDir })
    ).join('\n');

    return `<div class="slide" style="${style({
      width: px(canvasWidth),
      height: px(canvasHeight),
      position: 'relative',
      overflow: 'hidden',
      background,
      'font-family': 'Arial, Helvetica, sans-serif',
    })}">
${elements}
</div>`;
  }).join('\n\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: #111827;
      display: flex;
      flex-direction: column;
      gap: 24px;
      align-items: center;
    }
  </style>
</head>
<body>
${slideHtml}
</body>
</html>
`;
}

function renderElement(element, context) {
  const type = String(element.type || '').toLowerCase();
  if (type === 'text') return renderText(element);
  if (type === 'shape') return renderShape(element);
  if (type === 'line') return renderLine(element);
  if (type === 'image') return renderImage(element, context);
  throw new Error(`Unsupported element type: ${element.type}`);
}

function renderText(element) {
  return `<div style="${baseBoxStyle(element)} ${style({
    color: element.color || '#111111',
    'font-size': px(element.font_size || 18),
    'font-family': quoteFont(element.font_face || 'Arial'),
    'font-weight': element.bold ? '700' : '400',
    'font-style': element.italic ? 'italic' : undefined,
    'text-align': element.align || 'left',
    'line-height': element.line_height || 1.15,
    'white-space': 'pre-wrap',
    overflow: 'hidden',
  })}">${escapeHtml(element.text || '')}</div>`;
}

function renderShape(element) {
  const shape = String(element.shape || 'rect').toLowerCase();
  const common = {
    background: element.fill || 'transparent',
    border: border(element),
  };

  if (shape === 'oval' || shape === 'circle') {
    common['border-radius'] = '50%';
  } else if (shape === 'round_rect' || shape === 'rounded_rectangle') {
    common['border-radius'] = px(element.radius || 18);
  } else if (shape === 'triangle') {
    common.background = element.fill || '#111111';
    common['clip-path'] = 'polygon(50% 0, 0 100%, 100% 100%)';
  }

  return `<div style="${baseBoxStyle(element)} ${style(common)}"></div>`;
}

function renderLine(element) {
  const x1 = Number(element.x || 0);
  const y1 = Number(element.y || 0);
  const x2 = Number(element.x2 || x1);
  const y2 = Number(element.y2 || y1);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return `<div style="${style({
    position: 'absolute',
    left: px(x1),
    top: px(y1),
    width: px(length),
    height: 0,
    border: `${Number(element.stroke_width || 2)}px solid ${element.stroke || '#111111'}`,
    'border-width': `${Number(element.stroke_width || 2)}px 0 0 0`,
    transform: `rotate(${angle}deg)`,
    'transform-origin': '0 0',
  })}"></div>`;
}

function renderImage(element, context) {
  const src = resolveImageSrc(element.path || element.src || '', context.baseDir);
  return `<img src="${escapeHtml(src)}" alt="" style="${baseBoxStyle(element)} ${style({
    'object-fit': element.object_fit || 'fill',
    'border-radius': element.radius ? px(element.radius) : undefined,
  })}">`;
}

function resolveImageSrc(src, baseDir) {
  if (!src) return '';
  if (/^(https?:|data:|file:)/.test(src)) return src;
  if (path.isAbsolute(src)) return src;
  return path.resolve(baseDir, src);
}

function baseBoxStyle(element) {
  return style({
    position: 'absolute',
    left: px(element.x || 0),
    top: px(element.y || 0),
    width: px(element.w || 0),
    height: px(element.h || 0),
  });
}

function border(element) {
  const stroke = element.stroke;
  if (!stroke || stroke === 'none' || stroke === 'transparent') return 'none';
  return `${Number(element.stroke_width || 1)}px solid ${stroke}`;
}

function style(rules) {
  return Object.entries(rules)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
}

function px(value) {
  return `${Number(value)}px`;
}

function quoteFont(value) {
  if (String(value).includes(',')) return value;
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
