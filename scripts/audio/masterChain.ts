// The mastering chain of an episode, as ffmpeg filter graphs.
//
// The chain maps the Audacity steps of the runbook onto ffmpeg, in the order of the runbook: the
// noise reduction from a sampled noise profile, the compressor, the gate, the click removal, a
// plain gain to the target loudness, the limiter, the bed, and the de-esser.
// docs/live-show-runbook.md, "Post-production", holds the values and the reasons.

export const TARGET_LUFS = -16;
// The noise profile comes from the quietest window of this length. The sample skips a margin at
// each end of the window, because a sample that touches a word tail takes the shape of the voice.
export const NOISE_WINDOW_SECONDS = 2;
const NOISE_SAMPLE_MARGIN_SECONDS = 0.25;
// A window under this level is digital silence, not room noise.
const SILENCE_DB = -90;
const PROFILE_BANDS = 15;

export type MasterOptions = {
  input: string;
  slug: string;
  out?: string;
  bed?: { file: string; startSeconds: number };
  noiseAt?: number;
};

const USAGE =
  'Usage: npm run master -- --in <export.wav> --slug <slug> [--bed <file> --bed-at <seconds>] [--noise-at <seconds>] [--out <file.mp3>]';
const KNOWN_FLAGS = new Set(['in', 'slug', 'bed', 'bed-at', 'noise-at', 'out']);

function secondsOption(name: string, value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`${name} must be a number of seconds, 0 or more.`);
  }
  return seconds;
}

export function parseArgs(argv: readonly string[]): MasterOptions {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv.at(i);
    const value = argv.at(i + 1);
    if (flag === undefined || !flag.startsWith('--') || value === undefined) {
      throw new Error(USAGE);
    }
    const name = flag.slice(2);
    if (!KNOWN_FLAGS.has(name)) {
      throw new Error(`Unknown option ${flag}. ${USAGE}`);
    }
    values.set(name, value);
  }

  const input = values.get('in');
  const slug = values.get('slug');
  if (input === undefined || slug === undefined) {
    throw new Error(USAGE);
  }

  const options: MasterOptions = { input, slug };
  const out = values.get('out');
  if (out !== undefined) {
    options.out = out;
  }
  const noiseAt = values.get('noise-at');
  if (noiseAt !== undefined) {
    options.noiseAt = secondsOption('--noise-at', noiseAt);
  }

  const bedFile = values.get('bed');
  const bedAt = values.get('bed-at');
  if ((bedFile === undefined) !== (bedAt === undefined)) {
    throw new Error(`--bed and --bed-at go together. ${USAGE}`);
  }
  if (bedFile !== undefined && bedAt !== undefined) {
    options.bed = { file: bedFile, startSeconds: secondsOption('--bed-at', bedAt) };
  }

  return options;
}

const decibels = (value: number): string => `${value.toFixed(2)}dB`;

// Threshold -24 dB, ratio 2.5, make-up 8 dB, knee 6 dB, as in the runbook. acompressor has no lookahead.
const COMPRESSOR =
  'acompressor=threshold=0.0631:ratio=2.5:attack=3:release=100:makeup=2.512:knee=1.995';
// Threshold -42 dB and a range of -24 dB, the gate values of the runbook. The release of 500 ms
// stands in for the hold of 200 ms plus the decay of 300 ms, because agate has no hold.
const GATE =
  'agate=threshold=0.00794:ratio=9:range=0.0631:attack=10:release=500:knee=1:detection=peak';
// A brick wall at -2 dB, as the runbook limiter.
const LIMITER = 'alimiter=limit=0.7943:level=false';
// Intensity 0.5, as in the runbook. The user chose it by ear over 0.35 on 2026-11-13.
const DEESSER = 'deesser=i=0.5:m=0.5:f=0.5:s=o';
// amix needs one format on both inputs, and the MP3 is 44.1 kHz mono.
const MONO_44K = 'aformat=sample_rates=44100:channel_layouts=mono';
const LOUDNESS_MEASURE = `loudnorm=I=${String(TARGET_LUFS)}:TP=-2:LRA=20:print_format=json`;

// Prints the RMS level of each window of the input on stdout, one window per frame.
export function noiseWindowGraph(sampleRate: number): string {
  const samples = Math.round(sampleRate * NOISE_WINDOW_SECONDS);
  return `asetnsamples=n=${String(samples)}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`;
}

export type NoiseWindow = { startSeconds: number; rmsDb: number };

// The quietest window of the ametadata print, without the last window, which is cut short by
// the end of the file. A window under SILENCE_DB holds no room noise to sample.
export function quietestWindow(ametadataPrint: string): NoiseWindow {
  const windows: NoiseWindow[] = [];
  let startSeconds: number | undefined;
  for (const line of ametadataPrint.split('\n')) {
    const time = /pts_time:([-\d.]+)/.exec(line);
    if (time !== null) {
      startSeconds = Number(time[1]);
      continue;
    }
    const level = /RMS_level=(\S+)/.exec(line);
    if (level !== null && startSeconds !== undefined) {
      windows.push({ startSeconds, rmsDb: Number(level[1]) });
      startSeconds = undefined;
    }
  }
  windows.pop();
  const candidates = windows.filter(
    (window) => Number.isFinite(window.rmsDb) && window.rmsDb >= SILENCE_DB
  );
  const quietest = candidates.reduce<NoiseWindow | undefined>(
    (best, window) => (best === undefined || window.rmsDb < best.rmsDb ? window : best),
    undefined
  );
  if (quietest === undefined) {
    throw new Error('No window of room noise to sample. Pass --noise-at <seconds>.');
  }
  return quietest;
}

// Samples the noise profile inside the window, which starts at 0 after the seek of the input.
// afftdn prints the profile as "bn=<15 numbers>" when the sample stops.
export function noiseSampleGraph(): string {
  const start = NOISE_SAMPLE_MARGIN_SECONDS;
  const stop = NOISE_WINDOW_SECONDS - NOISE_SAMPLE_MARGIN_SECONDS;
  return `asendcmd=c='${String(start)} afftdn sn start\\; ${String(stop)} afftdn sn stop',afftdn=nr=12`;
}

export function parseNoiseProfile(ffmpegLog: string): string {
  const match = /bn=([-\d. ]+)/.exec(ffmpegLog);
  if (match === null) {
    throw new Error('No noise profile in the ffmpeg log.');
  }
  const bands = match[1].trim().split(/\s+/);
  if (bands.length !== PROFILE_BANDS || bands.some((band) => !Number.isFinite(Number(band)))) {
    throw new Error(`The noise profile has ${String(bands.length)} bands, not 15.`);
  }
  return bands.join('|');
}

// The profile gives the shape of the noise over the bands. Noise tracking sets its level.
export function voiceChain(noiseProfile: string): string {
  return `afftdn=nt=c:bn=${noiseProfile}:tn=1:nr=12,${COMPRESSOR},${GATE},adeclick`;
}

export function measureGraph(noiseProfile: string): string {
  return `${voiceChain(noiseProfile)},${LOUDNESS_MEASURE}`;
}

// The bed keeps the balance set by ear in Audacity. It gets the lift of the voice from the raw
// master to the target, so the raw master is measured with no chain.
export const RAW_MEASURE_GRAPH = LOUDNESS_MEASURE;

export function gainDb(measuredLufs: number, targetLufs: number): number {
  return targetLufs - measuredLufs;
}

// loudnorm prints one flat JSON object at the end of the ffmpeg log.
export function parseMeasuredLoudness(ffmpegLog: string): number {
  const start = ffmpegLog.lastIndexOf('{');
  const end = ffmpegLog.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error('No loudnorm JSON in the ffmpeg log.');
  }
  const parsed: unknown = JSON.parse(ffmpegLog.slice(start, end + 1));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('input_i' in parsed) ||
    typeof parsed.input_i !== 'string'
  ) {
    throw new Error('The loudnorm JSON has no input_i.');
  }
  const lufs = Number(parsed.input_i);
  if (!Number.isFinite(lufs)) {
    throw new Error(`Unreadable input_i: ${parsed.input_i}`);
  }
  return lufs;
}

export type RenderOptions = {
  noiseProfile: string;
  voiceGainDb: number;
  bed?: { gainDb: number; startSeconds: number };
};

export function renderGraph({ noiseProfile, voiceGainDb, bed }: RenderOptions): string {
  const voice = `[0:a]${voiceChain(noiseProfile)},volume=${decibels(voiceGainDb)},${MONO_44K}[voice]`;
  if (bed === undefined) {
    return `${voice};[voice]${LIMITER},${DEESSER}[out]`;
  }
  const delayMs = Math.round(bed.startSeconds * 1000);
  const bedChain = `[1:a]${MONO_44K},volume=${decibels(bed.gainDb)},adelay=delays=${String(delayMs)}:all=1[bed]`;
  // The limiter comes after the mix. A bed on top of the limited voice reached +1 dBTP.
  const mix = '[voice][bed]amix=inputs=2:duration=first:normalize=0[mix]';
  return `${voice};${bedChain};${mix};[mix]${LIMITER},${DEESSER}[out]`;
}

export type MediaRecord = {
  file: string;
  sha256: string;
  length: number;
  type: 'audio/mpeg';
  durationSeconds: number;
};

export function mediaRecord(
  file: string,
  sha256: string,
  length: number,
  durationSeconds: number
): MediaRecord {
  return { file, sha256, length, type: 'audio/mpeg', durationSeconds: Math.round(durationSeconds) };
}
