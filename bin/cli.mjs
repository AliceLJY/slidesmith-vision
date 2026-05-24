#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { specToHtml, readSpec } from '../lib/spec-to-html.mjs';

const args = process.argv.slice(2);

function usage() {
  console.log(`
  SlideSmith Vision - Convert visual slide specs to SlideSmith HTML

  Usage:
    slidesmith-vision <spec.json> -o <output.html>

  Options:
    -o, --output    Output HTML path
    -h, --help      Show help

  Example:
    slidesmith-vision examples/basic/spec.json -o /tmp/basic.html
`);
}

if (args.includes('-h') || args.includes('--help') || args.length === 0) {
  usage();
  process.exit(0);
}

const outputIdx = args.findIndex((arg) => arg === '-o' || arg === '--output');
const input = args.find((arg, idx) => !arg.startsWith('-') && idx !== outputIdx + 1);
const output = outputIdx >= 0 ? args[outputIdx + 1] : null;

if (!input || !output) {
  usage();
  process.exit(1);
}

const inputPath = path.resolve(input);
const outputPath = path.resolve(output);
const spec = await readSpec(inputPath);
const html = specToHtml(spec, {
  title: spec.title || path.basename(inputPath, path.extname(inputPath)),
  baseDir: path.dirname(inputPath),
});

await writeFile(outputPath, html, 'utf8');

console.log(`Wrote ${pathToFileURL(outputPath).href}`);
