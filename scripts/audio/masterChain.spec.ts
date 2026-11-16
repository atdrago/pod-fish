import { describe, expect, it } from 'vitest';

import {
  RAW_MEASURE_GRAPH,
  gainDb,
  measureGraph,
  mediaRecord,
  noiseSampleGraph,
  noiseWindowGraph,
  parseArgs,
  parseMeasuredLoudness,
  parseNoiseProfile,
  quietestWindow,
  renderGraph,
  voiceChain
} from './masterChain.ts';

const PROFILE = '17.4|14.5|11.0|7.3|3.6|0.4|-2.3|-4.4|-5.8|-6.7|-6.9|-6.9|-6.7|-6.8|-7.5';

describe('parseArgs', () => {
  it('reads the input, the slug, the output, the bed, and the noise window', () => {
    const options = parseArgs([
      '--in',
      'a.wav',
      '--slug',
      '002-x',
      '--bed',
      'bed.mp3',
      '--bed-at',
      '12.5',
      '--noise-at',
      '3768',
      '--out',
      'x.mp3'
    ]);

    expect(options).toEqual({
      input: 'a.wav',
      slug: '002-x',
      out: 'x.mp3',
      bed: { file: 'bed.mp3', startSeconds: 12.5 },
      noiseAt: 3768
    });
  });

  it('leaves the bed, the noise window, and the output out when they are not given', () => {
    expect(parseArgs(['--in', 'a.wav', '--slug', '002-x'])).toEqual({
      input: 'a.wav',
      slug: '002-x'
    });
  });

  it('rejects a missing slug, an unknown flag, a lone bed, and a bad time', () => {
    expect(() => parseArgs(['--in', 'a.wav'])).toThrow('Usage');
    expect(() => parseArgs(['--in', 'a.wav', '--slug', 's', '--loud', '1'])).toThrow('--loud');
    expect(() => parseArgs(['--in', 'a.wav', '--slug', 's', '--bed', 'b.mp3'])).toThrow('--bed-at');
    expect(() =>
      parseArgs(['--in', 'a.wav', '--slug', 's', '--bed', 'b', '--bed-at', 'x'])
    ).toThrow('--bed-at must be');
    expect(() => parseArgs(['--in', 'a.wav', '--slug', 's', '--noise-at', '-1'])).toThrow(
      '--noise-at must be'
    );
  });
});

describe('noiseWindowGraph', () => {
  it('cuts the input into two-second windows at the sample rate of the input', () => {
    expect(noiseWindowGraph(48000)).toMatch(/^asetnsamples=n=96000:p=0,astats=metadata=1:reset=1/);
    expect(noiseWindowGraph(44100)).toContain(
      'ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-'
    );
  });
});

describe('quietestWindow', () => {
  const print = (levels: readonly (number | string)[]): string =>
    levels
      .map((level, index) =>
        [
          `frame:${String(index)} pts:${String(index * 88200)} pts_time:${String(index * 2)}`,
          `lavfi.astats.Overall.RMS_level=${String(level)}`
        ].join('\n')
      )
      .join('\n');

  it('picks the window with the lowest level, and skips the last window', () => {
    expect(quietestWindow(print([-30, -58.7, -41, -63.8, -40, -70]))).toEqual({
      startSeconds: 6,
      rmsDb: -63.8
    });
  });

  it('skips digital silence', () => {
    expect(quietestWindow(print(['-inf', -95, -30, -52, -29]))).toEqual({
      startSeconds: 6,
      rmsDb: -52
    });
  });

  it('asks for --noise-at when no window holds room noise', () => {
    expect(() => quietestWindow(print(['-inf', '-inf']))).toThrow('--noise-at');
  });
});

describe('noiseSampleGraph', () => {
  it('samples between the margins of the window and escapes the command separator', () => {
    expect(noiseSampleGraph()).toBe(
      "asendcmd=c='0.25 afftdn sn start\\; 1.75 afftdn sn stop',afftdn=nr=12"
    );
  });
});

describe('parseNoiseProfile', () => {
  it('reads the 15 bands that afftdn prints and joins them for the bn option', () => {
    const ffmpegLog = [
      '[Parsed_afftdn_1 @ 0x1] bn=17.400000 14.500000 11.000000 7.300000 3.600000 0.400000 -2.300000 -4.400000 -5.800000 -6.700000 -6.900000 -6.900000 -6.700000 -6.800000 -7.500000 ',
      'size=N/A time=00:00:02.00'
    ].join('\n');

    expect(parseNoiseProfile(ffmpegLog)).toBe(
      '17.400000|14.500000|11.000000|7.300000|3.600000|0.400000|-2.300000|-4.400000|-5.800000|-6.700000|-6.900000|-6.900000|-6.700000|-6.800000|-7.500000'
    );
  });

  it('rejects a log without the profile, and a profile with the wrong band count', () => {
    expect(() => parseNoiseProfile('nothing here')).toThrow('No noise profile');
    expect(() => parseNoiseProfile('bn=1 2 3 ')).toThrow('3 bands');
  });
});

describe('voiceChain', () => {
  it('runs the noise reduction, the compressor, the gate, and the click removal in that order', () => {
    const chain = voiceChain(PROFILE);
    const positions = [
      `afftdn=nt=c:bn=${PROFILE}:tn=1:nr=12`,
      'acompressor=',
      'agate=',
      'adeclick'
    ].map((part) => chain.indexOf(part));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(positions.every((position) => position >= 0)).toBe(true);
  });

  it('measures the loudness after the chain', () => {
    expect(measureGraph(PROFILE)).toBe(
      `${voiceChain(PROFILE)},loudnorm=I=-16:TP=-2:LRA=20:print_format=json`
    );
  });
});

describe('RAW_MEASURE_GRAPH', () => {
  it('measures the loudness with no chain', () => {
    expect(RAW_MEASURE_GRAPH).toContain('loudnorm');
    expect(RAW_MEASURE_GRAPH).not.toContain('afftdn');
  });
});

describe('gainDb', () => {
  it('is the distance from the measured loudness to the target', () => {
    expect(gainDb(-26.3, -16)).toBeCloseTo(10.3);
  });
});

describe('parseMeasuredLoudness', () => {
  it('reads input_i from the loudnorm JSON at the end of the log', () => {
    const ffmpegLog = [
      'Input #0, wav, from "a.wav":',
      '[Parsed_loudnorm_1 @ 0x1] ',
      '{',
      '\t"input_i" : "-26.35",',
      '\t"input_tp" : "-2.35",',
      '\t"target_offset" : "0.10"',
      '}'
    ].join('\n');

    expect(parseMeasuredLoudness(ffmpegLog)).toBeCloseTo(-26.35);
  });

  it('rejects a log without the JSON', () => {
    expect(() => parseMeasuredLoudness('nothing here')).toThrow('loudnorm');
  });
});

describe('renderGraph', () => {
  it('applies the gain, the limiter, and the de-esser to the voice without a bed', () => {
    const graph = renderGraph({ noiseProfile: PROFILE, voiceGainDb: 10.3 });

    expect(graph).toContain(`[0:a]afftdn=nt=c:bn=${PROFILE}:tn=1:nr=12`);
    expect(graph).toContain('volume=10.30dB,alimiter=limit=0.7943:level=false');
    expect(graph).toMatch(/\[voice\]deesser=i=0\.5:m=0\.5:f=0\.5:s=o\[out\]$/);
    expect(graph).not.toContain('amix');
  });

  it('delays and mixes the bed under the voice', () => {
    const graph = renderGraph({
      noiseProfile: PROFILE,
      voiceGainDb: 10.3,
      bed: { gainDb: -20, startSeconds: 12.5 }
    });

    expect(graph).toContain('[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume=-20.00dB');
    expect(graph).toContain('adelay=delays=12500:all=1[bed]');
    expect(graph).toContain('[voice][bed]amix=inputs=2:duration=first:normalize=0[mix]');
    expect(graph).toMatch(/\[mix\]deesser=.*\[out\]$/);
  });
});

describe('mediaRecord', () => {
  it('rounds the duration and names the MP3 type', () => {
    expect(mediaRecord('x.mp3', 'abc', 10, 4767.56)).toEqual({
      file: 'x.mp3',
      sha256: 'abc',
      length: 10,
      type: 'audio/mpeg',
      durationSeconds: 4768
    });
  });
});
