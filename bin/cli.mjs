#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpath, stat, writeFile } from 'node:fs/promises';
import { specToHtml, readSpec } from '../lib/spec-to-html.mjs';

const args = process.argv.slice(2);

function usage() {
  console.log(`
  SlideSmith Vision - Convert visual slide specs to SlideSmith-compatible HTML

  Usage:
    slidesmith-vision <spec.json> -o <output.html> [--allow-missing-images]

  Options:
    -o, --output             Output HTML path
    --allow-missing-images   Preserve unreadable local image src values with a warning
                             (the output may no longer be self-contained)
    -h, --help               Show help

  Example:
    slidesmith-vision examples/basic/spec.json -o /tmp/basic.html

  This command emits HTML for downstream SlideSmith. It does not create PPTX files.
`);
}

function parseArgs(argv) {
  const parsed = {
    input: null,
    output: null,
    allowMissingImages: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--allow-missing-images') {
      parsed.allowMissingImages = true;
      continue;
    }

    if (arg === '-o' || arg === '--output') {
      const output = argv[index + 1];
      if (!output || output.startsWith('-')) {
        throw new Error(`${arg} requires an output path`);
      }
      if (parsed.output !== null) {
        throw new Error('Output path was provided more than once');
      }
      parsed.output = output;
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option ${JSON.stringify(arg)}`);
    }

    if (parsed.input !== null) {
      throw new Error(`Unexpected argument ${JSON.stringify(arg)}`);
    }
    parsed.input = arg;
  }

  if (!parsed.input || !parsed.output) {
    throw new Error('Both <spec.json> and -o <output.html> are required');
  }

  return parsed;
}

async function main() {
  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    usage();
    return;
  }

  const { input, output, allowMissingImages } = parseArgs(args);
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (inputPath === outputPath) {
    throw new Error('Input spec and output HTML must be different files');
  }

  const spec = await readSpec(inputPath);
  await assertDistinctFiles(inputPath, outputPath);
  const html = specToHtml(spec, {
    title: spec.title || path.basename(inputPath, path.extname(inputPath)),
    baseDir: path.dirname(inputPath),
    specPath: inputPath,
    allowMissingImages,
  });

  try {
    await writeFile(outputPath, html, 'utf8');
  } catch (error) {
    throw new Error(`Cannot write output ${JSON.stringify(outputPath)}: ${error.message}`, { cause: error });
  }

  console.log(`Wrote ${pathToFileURL(outputPath).href}`);
}

async function assertDistinctFiles(inputPath, outputPath) {
  const inputRealPath = await realpath(inputPath);
  let outputRealPath;
  try {
    outputRealPath = await realpath(outputPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`Cannot inspect output ${JSON.stringify(outputPath)}: ${error.message}`, { cause: error });
    }
    return;
  }

  const [inputStat, outputStat] = await Promise.all([stat(inputRealPath), stat(outputRealPath)]);
  const sameInode = inputStat.ino !== 0
    && outputStat.ino !== 0
    && inputStat.dev === outputStat.dev
    && inputStat.ino === outputStat.ino;
  if (
    inputRealPath === outputRealPath
    || sameInode
  ) {
    throw new Error('Input spec and output HTML must be different files');
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`slidesmith-vision: ${message}`);
  process.exitCode = 1;
});
