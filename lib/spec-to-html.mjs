import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function readSpec(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read spec ${JSON.stringify(filePath)}: ${error.message}`, { cause: error });
  }

  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in spec ${JSON.stringify(filePath)}: ${error.message}`, { cause: error });
  }

  return validateSpec(spec, { specPath: filePath });
}

export function specToHtml(spec, options = {}) {
  validateSpec(spec, { specPath: options.specPath });

  const canvasWidth = spec.canvas_width;
  const canvasHeight = spec.canvas_height;
  const slides = spec.slides;
  const title = options.title ?? spec.title ?? 'SlideSmith Vision';
  const baseDir = options.baseDir || process.cwd();
  const specPath = options.specPath || '<in-memory spec>';
  const allowMissingImages = options.allowMissingImages === true;

  const slideHtml = slides.map((slide, slideIndex) => {
    const background = slide.background ?? spec.background ?? '#ffffff';
    const elements = slide.elements.map((element, elementIndex) =>
      renderElement(element, {
        canvasWidth,
        canvasHeight,
        baseDir,
        specPath,
        slideIndex,
        elementIndex,
        allowMissingImages,
      })
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

const ELEMENT_TYPES = new Set(['text', 'shape', 'line', 'image']);
const SHAPE_TYPES = new Set([
  'rect',
  'rectangle',
  'oval',
  'circle',
  'round_rect',
  'rounded_rectangle',
  'triangle',
]);

export function validateSpec(spec, options = {}) {
  const specPath = options.specPath || '<in-memory spec>';

  requireObject(spec, specPath, 'spec');
  requirePositiveNumber(spec.canvas_width, specPath, 'canvas_width');
  requirePositiveNumber(spec.canvas_height, specPath, 'canvas_height');
  optionalString(spec.title, specPath, 'title');
  optionalString(spec.background, specPath, 'background');

  if (!Array.isArray(spec.slides)) {
    invalidSpec(specPath, 'slides must be an array');
  }
  if (spec.slides.length === 0) {
    invalidSpec(specPath, 'slides must contain at least one slide');
  }

  spec.slides.forEach((slide, slideIndex) => {
    const slidePath = `slides[${slideIndex}]`;
    requireObject(slide, specPath, slidePath);
    optionalString(slide.background, specPath, `${slidePath}.background`);

    if (!Array.isArray(slide.elements)) {
      invalidSpec(specPath, `${slidePath}.elements must be an array`);
    }

    slide.elements.forEach((element, elementIndex) => {
      validateElement(element, specPath, `${slidePath}.elements[${elementIndex}]`);
    });
  });

  return spec;
}

function validateElement(element, specPath, elementPath) {
  requireObject(element, specPath, elementPath);

  if (typeof element.type !== 'string' || element.type.trim() === '') {
    invalidSpec(specPath, `${elementPath}.type must be a non-empty string`);
  }

  const type = element.type.toLowerCase();
  if (!ELEMENT_TYPES.has(type)) {
    invalidSpec(
      specPath,
      `${elementPath}.type must be one of ${[...ELEMENT_TYPES].join(', ')}; received ${JSON.stringify(element.type)}`,
    );
  }

  requireFiniteNumber(element.x, specPath, `${elementPath}.x`);
  requireFiniteNumber(element.y, specPath, `${elementPath}.y`);

  if (type === 'line') {
    requireFiniteNumber(element.x2, specPath, `${elementPath}.x2`);
    requireFiniteNumber(element.y2, specPath, `${elementPath}.y2`);
    if (element.x === element.x2 && element.y === element.y2) {
      invalidSpec(specPath, `${elementPath} line endpoints must not be identical`);
    }
  } else {
    requirePositiveNumber(element.w, specPath, `${elementPath}.w`);
    requirePositiveNumber(element.h, specPath, `${elementPath}.h`);
  }

  if (type === 'text' && typeof element.text !== 'string') {
    invalidSpec(specPath, `${elementPath}.text must be a string`);
  }

  if (type === 'shape' && element.shape !== undefined) {
    if (typeof element.shape !== 'string' || !SHAPE_TYPES.has(element.shape.toLowerCase())) {
      invalidSpec(
        specPath,
        `${elementPath}.shape must be one of ${[...SHAPE_TYPES].join(', ')}; received ${JSON.stringify(element.shape)}`,
      );
    }
  }

  if (type === 'image') {
    validateImageSource(element, specPath, elementPath);
  }

  for (const field of ['color', 'font_face', 'align', 'fill', 'stroke', 'object_fit']) {
    optionalString(element[field], specPath, `${elementPath}.${field}`);
  }
  for (const field of ['font_size', 'line_height', 'stroke_width']) {
    optionalPositiveNumber(element[field], specPath, `${elementPath}.${field}`);
  }
  optionalNonNegativeNumber(element.radius, specPath, `${elementPath}.radius`);
  optionalBoolean(element.bold, specPath, `${elementPath}.bold`);
  optionalBoolean(element.italic, specPath, `${elementPath}.italic`);
}

function validateImageSource(element, specPath, elementPath) {
  let hasSource = false;

  for (const field of ['path', 'src']) {
    if (element[field] === undefined) continue;
    hasSource = true;
    if (typeof element[field] !== 'string' || element[field].trim() === '') {
      invalidSpec(specPath, `${elementPath}.${field} must be a non-empty string`);
    }
  }

  if (!hasSource) {
    invalidSpec(specPath, `${elementPath} must define a non-empty path or src`);
  }
}

function requireObject(value, specPath, fieldPath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalidSpec(specPath, `${fieldPath} must be an object`);
  }
}

function requireFiniteNumber(value, specPath, fieldPath) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalidSpec(specPath, `${fieldPath} must be a finite number`);
  }
}

function requirePositiveNumber(value, specPath, fieldPath) {
  requireFiniteNumber(value, specPath, fieldPath);
  if (value <= 0) {
    invalidSpec(specPath, `${fieldPath} must be greater than 0`);
  }
}

function optionalPositiveNumber(value, specPath, fieldPath) {
  if (value !== undefined) requirePositiveNumber(value, specPath, fieldPath);
}

function optionalNonNegativeNumber(value, specPath, fieldPath) {
  if (value === undefined) return;
  requireFiniteNumber(value, specPath, fieldPath);
  if (value < 0) {
    invalidSpec(specPath, `${fieldPath} must be greater than or equal to 0`);
  }
}

function optionalString(value, specPath, fieldPath) {
  if (value !== undefined && typeof value !== 'string') {
    invalidSpec(specPath, `${fieldPath} must be a string`);
  }
}

function optionalBoolean(value, specPath, fieldPath) {
  if (value !== undefined && typeof value !== 'boolean') {
    invalidSpec(specPath, `${fieldPath} must be a boolean`);
  }
}

function invalidSpec(specPath, detail) {
  throw new TypeError(`Invalid spec ${JSON.stringify(specPath)}: ${detail}`);
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
    'font-size': px(element.font_size ?? 18),
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
  const shape = String(element.shape ?? 'rect').toLowerCase();
  const common = {
    background: element.fill || 'transparent',
    border: border(element),
  };

  if (shape === 'oval' || shape === 'circle') {
    common['border-radius'] = '50%';
  } else if (shape === 'round_rect' || shape === 'rounded_rectangle') {
    common['border-radius'] = px(element.radius ?? 18);
  } else if (shape === 'triangle') {
    common.background = element.fill || '#111111';
    common['clip-path'] = 'polygon(50% 0, 0 100%, 100% 100%)';
  }

  return `<div style="${baseBoxStyle(element)} ${style(common)}"></div>`;
}

function renderLine(element) {
  const x1 = element.x;
  const y1 = element.y;
  const x2 = element.x2;
  const y2 = element.y2;
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
    border: `${element.stroke_width ?? 2}px solid ${element.stroke || '#111111'}`,
    'border-width': `${element.stroke_width ?? 2}px 0 0 0`,
    transform: `rotate(${angle}deg)`,
    'transform-origin': '0 0',
  })}"></div>`;
}

function renderImage(element, context) {
  const sourceField = element.path !== undefined ? 'path' : 'src';
  const originalSrc = element[sourceField];
  const src = resolveImageSrc(originalSrc, { ...context, sourceField });
  return `<img src="${escapeHtml(src)}" alt="" style="${baseBoxStyle(element)} ${style({
    'object-fit': element.object_fit || 'fill',
    'border-radius': element.radius ? px(element.radius) : undefined,
  })}">`;
}

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

// Readable local images are inlined as data URIs so successful default output
// does not retain filesystem dependencies. HTTP(S) and data URIs are preserved.
function resolveImageSrc(src, context) {
  if (/^(https?:|data:)/i.test(src)) return src;

  let filePath;
  try {
    filePath = /^file:/i.test(src)
      ? fileURLToPath(src)
      : (path.isAbsolute(src) ? src : path.resolve(context.baseDir, src));
    const mime = IMAGE_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const contents = readFileSync(filePath);
    if (contents.length === 0) {
      throw new Error('image file is empty');
    }
    return `data:${mime};base64,${contents.toString('base64')}`;
  } catch (error) {
    const location = `spec ${JSON.stringify(context.specPath)}, slides[${context.slideIndex}].elements[${context.elementIndex}].${context.sourceField}`;
    const resolvedPath = filePath ? ` (resolved to ${JSON.stringify(filePath)})` : '';
    const reason = error instanceof Error ? `: ${error.message}` : '';
    const detail = `cannot read local image ${JSON.stringify(src)} referenced at ${location}${resolvedPath}${reason}`;

    if (context.allowMissingImages) {
      console.warn(
        `slidesmith-vision: warning: ${detail}; --allow-missing-images is enabled, preserving the original src; generated HTML may not be self-contained`,
      );
      return src;
    }

    throw new Error(
      `${detail}. Use --allow-missing-images to preserve the original src instead.`,
      { cause: error },
    );
  }
}

function baseBoxStyle(element) {
  return style({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(element.w),
    height: px(element.h),
  });
}

function border(element) {
  const stroke = element.stroke;
  if (!stroke || stroke === 'none' || stroke === 'transparent') return 'none';
  return `${element.stroke_width ?? 1}px solid ${stroke}`;
}

function style(rules) {
  const css = Object.entries(rules)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value};`)
    .join(' ');
  // CSS values come from reconstruction specs. Encode the complete attribute
  // value so quotes cannot escape style="..." and create new HTML attributes.
  return escapeHtml(css);
}

function px(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new TypeError(`Cannot render non-numeric pixel value ${JSON.stringify(value)}`);
  }
  return `${n}px`;
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
