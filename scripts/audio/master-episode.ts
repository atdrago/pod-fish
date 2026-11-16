#!/usr/bin/env node
// Masters one episode from the Audacity export, and prints the media record for episode.json.
//
// Usage:
//   npm run master -- --in <export.wav> --slug <slug> [--bed <file> --bed-at <seconds>] [--noise-at <seconds>] [--out <file.mp3>]
//
// Without --out, the MP3 lands in <CONTENT_FOLDER>/episodes/<slug>/media/<slug>.mp3. Without
// --noise-at, the noise profile comes from the quietest two seconds of the export.
// docs/live-show-runbook.md, "Post-production", holds the steps before and after this script.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';

import {
  NOISE_WINDOW_SECONDS,
  RAW_MEASURE_GRAPH,
  TARGET_LUFS,
  gainDb,
  measureGraph,
  mediaRecord,
  noiseSampleGraph,
  noiseWindowGraph,
  parseArgs,
  parseMeasuredLoudness,
  parseNoiseProfile,
  quietestWindow,
  renderGraph
} from './masterChain.ts';

function log(event: string, fields: Record<string, string>): void {
  const pairs = Object.entries(fields).map(([name, value]) => `${name}=${value}`);
  console.error(`${event} ${pairs.join(' ')}`);
}

function run(command: string, args: string[], captureLog: boolean): string {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', captureLog ? 'pipe' : 'inherit'],
    maxBuffer: 1 << 26,
    encoding: 'utf8'
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = captureLog ? `\n${result.stderr}` : '';
    throw new Error(`${command} exited with ${String(result.status)}.${detail}`);
  }
  return captureLog ? result.stderr : result.stdout;
}

const FFMPEG_QUIET = ['-nostdin', '-hide_banner', '-nostats'];

function measureLufs(file: string, graph: string): number {
  const ffmpegLog = run(
    'ffmpeg',
    [...FFMPEG_QUIET, '-i', file, '-af', graph, '-f', 'null', '-'],
    true
  );
  return parseMeasuredLoudness(ffmpegLog);
}

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function probe(file: string, entries: string): string {
  return run(
    'ffprobe',
    ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file],
    false
  ).trim();
}

function noiseProfileOf(input: string, noiseAt: number | undefined): string {
  let startSeconds = noiseAt;
  if (startSeconds === undefined) {
    const sampleRate = Number(probe(input, 'stream=sample_rate'));
    const windows = run(
      'ffmpeg',
      [
        ...FFMPEG_QUIET,
        '-loglevel',
        'warning',
        '-i',
        input,
        '-af',
        noiseWindowGraph(sampleRate),
        '-f',
        'null',
        '-'
      ],
      false
    );
    const window = quietestWindow(windows);
    log('master_noise_window', {
      startSeconds: String(window.startSeconds),
      rmsDb: window.rmsDb.toFixed(1)
    });
    startSeconds = window.startSeconds;
  }
  const sampleLog = run(
    'ffmpeg',
    [
      ...FFMPEG_QUIET,
      '-ss',
      String(startSeconds),
      '-t',
      String(NOISE_WINDOW_SECONDS),
      '-i',
      input,
      '-af',
      noiseSampleGraph(),
      '-f',
      'null',
      '-'
    ],
    true
  );
  const profile = parseNoiseProfile(sampleLog);
  log('master_noise_profile', { startSeconds: String(startSeconds), bands: profile });
  return profile;
}

function defaultOutput(slug: string): string {
  const folder = process.env.CONTENT_FOLDER;
  if (folder === undefined || folder === '') {
    throw new Error('Set CONTENT_FOLDER in .env, or pass --out.');
  }
  return join(folder, 'episodes', slug, 'media', `${slug}.mp3`);
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const outPath = options.out ?? defaultOutput(options.slug);
  mkdirSync(dirname(outPath), { recursive: true });

  const noiseProfile = noiseProfileOf(options.input, options.noiseAt);

  log('master_measure', { input: options.input });
  const voiceLufs = measureLufs(options.input, measureGraph(noiseProfile));
  const voiceGainDb = gainDb(voiceLufs, TARGET_LUFS);
  log('master_voice', { lufs: voiceLufs.toFixed(1), gainDb: voiceGainDb.toFixed(2) });

  let bed: { gainDb: number; startSeconds: number } | undefined;
  if (options.bed !== undefined) {
    const rawVoiceLufs = measureLufs(options.input, RAW_MEASURE_GRAPH);
    const bedGainDb = gainDb(rawVoiceLufs, TARGET_LUFS);
    log('master_bed', {
      rawVoiceLufs: rawVoiceLufs.toFixed(1),
      gainDb: bedGainDb.toFixed(2),
      startSeconds: String(options.bed.startSeconds)
    });
    bed = { gainDb: bedGainDb, startSeconds: options.bed.startSeconds };
  }

  const inputs = ['-i', options.input];
  if (options.bed !== undefined) {
    inputs.push('-i', options.bed.file);
  }
  log('master_render', { out: outPath });
  run(
    'ffmpeg',
    [
      ...FFMPEG_QUIET,
      '-y',
      ...inputs,
      '-filter_complex',
      renderGraph({ noiseProfile, voiceGainDb, bed }),
      '-map',
      '[out]',
      // The WAV export of Audacity carries its track name and number as tags.
      '-map_metadata',
      '-1',
      '-ar',
      '44100',
      '-ac',
      '1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '128k',
      outPath
    ],
    false
  );

  const record = mediaRecord(
    basename(outPath),
    sha256Of(outPath),
    statSync(outPath).size,
    Number(probe(outPath, 'format=duration'))
  );
  log('master_done', { out: outPath });
  console.log(JSON.stringify(record, null, 2));
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
