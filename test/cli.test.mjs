import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readSpec, specToHtml } from '../lib/spec-to-html.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const cliPath = path.join(repoRoot, 'bin', 'cli.mjs');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'slidesmith-vision-test-'));

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

async function writeJson(name, value) {
  const filePath = path.join(tempRoot, name);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function imageSpec(imagePath) {
  return {
    canvas_width: 800,
    canvas_height: 450,
    slides: [
      {
        elements: [
          {
            type: 'image',
            path: imagePath,
            x: 10,
            y: 20,
            w: 320,
            h: 180,
          },
        ],
      },
    ],
  };
}

test('basic conversion emits deterministic SlideSmith-compatible HTML', async () => {
  const outputPath = path.join(tempRoot, 'basic.html');
  const result = runCli([
    path.join(repoRoot, 'examples', 'basic', 'spec.json'),
    '-o',
    outputPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('Wrote file:'));

  const html = await readFile(outputPath, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<title>SlideSmith Vision Basic Example</title>'));
  assert.ok(html.includes('width: 1920px;'));
  assert.ok(html.includes('height: 1080px;'));
  assert.ok(html.includes('Vision Spec to SlideSmith HTML'));
});

test('readable local images are inlined as exact data URIs', async () => {
  const specPath = path.join(repoRoot, 'examples', 'with-image', 'spec.json');
  const imagePath = path.join(repoRoot, 'examples', 'with-image', 'photo.png');
  const outputPath = path.join(tempRoot, 'with-image.html');
  const result = runCli([specPath, '--output', outputPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  const expectedDataUri = `data:image/png;base64,${(await readFile(imagePath)).toString('base64')}`;
  const html = await readFile(outputPath, 'utf8');
  assert.ok(html.includes(`src="${expectedDataUri}"`));
  assert.ok(!html.includes('src="photo.png"'));
});

test('missing local images fail by default with spec and element context', async () => {
  const specPath = await writeJson('missing-image.json', imageSpec('missing.png'));
  const outputPath = path.join(tempRoot, 'missing-default.html');
  const result = runCli([specPath, '-o', outputPath]);

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('cannot read local image "missing.png"'));
  assert.ok(result.stderr.includes(specPath));
  assert.ok(result.stderr.includes('slides[0].elements[0].path'));
  assert.ok(result.stderr.includes('--allow-missing-images'));
  assert.equal(await pathExists(outputPath), false);
});

test('--allow-missing-images preserves src and emits a clear warning', async () => {
  const specPath = await writeJson('allowed-missing-image.json', imageSpec('missing.png'));
  const outputPath = path.join(tempRoot, 'missing-allowed.html');
  const result = runCli([
    specPath,
    '-o',
    outputPath,
    '--allow-missing-images',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stderr.includes('slidesmith-vision: warning:'));
  assert.ok(result.stderr.includes(specPath));
  assert.ok(result.stderr.includes('slides[0].elements[0].path'));
  assert.ok(result.stderr.includes('--allow-missing-images is enabled'));
  assert.ok(result.stderr.includes('generated HTML may not be self-contained'));

  const html = await readFile(outputPath, 'utf8');
  assert.ok(html.includes('src="missing.png"'));
});

test('invalid specs fail consistently instead of producing empty or 0px output', async (t) => {
  const cases = [
    {
      name: 'missing-slides',
      spec: { canvas_width: 800, canvas_height: 450 },
      expected: 'slides must be an array',
    },
    {
      name: 'empty-slides',
      spec: { canvas_width: 800, canvas_height: 450, slides: [] },
      expected: 'slides must contain at least one slide',
    },
    {
      name: 'zero-canvas-width',
      spec: { canvas_width: 0, canvas_height: 450, slides: [{ elements: [] }] },
      expected: 'canvas_width must be greater than 0',
    },
    {
      name: 'missing-elements',
      spec: { canvas_width: 800, canvas_height: 450, slides: [{}] },
      expected: 'slides[0].elements must be an array',
    },
    {
      name: 'zero-element-width',
      spec: {
        canvas_width: 800,
        canvas_height: 450,
        slides: [{ elements: [{ type: 'text', x: 0, y: 0, w: 0, h: 40, text: 'Title' }] }],
      },
      expected: 'slides[0].elements[0].w must be greater than 0',
    },
  ];

  for (const invalidCase of cases) {
    await t.test(invalidCase.name, async () => {
      const specPath = await writeJson(`${invalidCase.name}.json`, invalidCase.spec);
      const outputPath = path.join(tempRoot, `${invalidCase.name}.html`);
      const result = runCli([specPath, '-o', outputPath]);

      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(`Invalid spec "${specPath}"`));
      assert.ok(result.stderr.includes(invalidCase.expected));
      assert.equal(await pathExists(outputPath), false);

      await assert.rejects(
        readSpec(specPath),
        (error) => error.message.includes(specPath) && error.message.includes(invalidCase.expected),
      );
    });
  }

  assert.throws(
    () => specToHtml(cases[0].spec, { specPath: 'direct-invalid.json' }),
    (error) => error.message.includes('direct-invalid.json') && error.message.includes(cases[0].expected),
  );
});

test('spec CSS strings cannot escape the style attribute boundary', () => {
  const html = specToHtml({
    canvas_width: 800,
    canvas_height: 450,
    slides: [
      {
        elements: [
          {
            type: 'text',
            x: 10,
            y: 20,
            w: 320,
            h: 80,
            text: 'Safe text',
            color: 'red\" onmouseover=\"alert(1)',
            font_face: 'Arial\" autofocus onfocus=\"alert(2)',
          },
        ],
      },
    ],
  });

  assert.ok(html.includes('&quot;'));
  assert.doesNotMatch(
    html,
    /style="[^"]*"\s+(?:onmouseover|autofocus|onfocus)\b/,
  );
});
