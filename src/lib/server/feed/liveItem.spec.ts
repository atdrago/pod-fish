import { describe, expect, it } from 'vitest';
import type { LiveItemRecord } from '$lib/server/content/schemas';
import { insertLiveItemChildren } from './liveItem';

const RECORD: LiveItemRecord = {
  revision: 1,
  draft: false,
  title: 'First',
  guid: 'guid-first',
  description: 'The first show.',
  status: 'pending',
  start: '2026-11-06T20:00:00-05:00',
  durationMinutes: 120,
  enclosure: { url: 'https://example.com/live.mp3?a=1&b=2', type: 'audio/mpeg' }
};

describe('insertLiveItemChildren', () => {
  it('opens a self-closing element and closes it around the children', () => {
    const xml = insertLiveItemChildren('<podcast:liveItem status="pending"/>', [RECORD]);

    expect(xml).toMatch(/^<podcast:liveItem status="pending">\n/);
    expect(xml).toMatch(/<\/podcast:liveItem>$/);
    expect(xml).toContain('<title>First</title>');
    expect(xml).not.toContain('"/>\n    </podcast:liveItem>"');
  });

  it('inserts after the open tag when the element has children', () => {
    const xml = insertLiveItemChildren(
      '<podcast:liveItem status="live"><podcast:contentLink href="x"/></podcast:liveItem>',
      [RECORD]
    );

    expect(xml.indexOf('<title>')).toBeGreaterThan(xml.indexOf('status="live">'));
    expect(xml.indexOf('<title>')).toBeLessThan(xml.indexOf('<podcast:contentLink'));
    expect(xml.match(/<\/podcast:liveItem>/g)).toHaveLength(1);
  });

  it('keeps array order across the two element shapes', () => {
    const xml = insertLiveItemChildren(
      '<podcast:liveItem status="live"><podcast:txt>x</podcast:txt></podcast:liveItem><podcast:liveItem status="pending"/>',
      [RECORD, { ...RECORD, title: 'Second', guid: 'guid-second' }]
    );

    expect(xml.indexOf('First')).toBeLessThan(xml.indexOf('</podcast:liveItem>'));
    expect(xml.indexOf('Second')).toBeGreaterThan(xml.indexOf('</podcast:liveItem>'));
  });

  it('leaves the text of a live item tag alone inside a CDATA section', () => {
    const cdata = '<description><![CDATA[<podcast:liveItem status="x"/>]]></description>';
    const xml = insertLiveItemChildren(`${cdata}<podcast:liveItem status="live"/>`, [RECORD]);

    expect(xml.startsWith(cdata)).toBe(true);
    expect(xml.match(/<title>/g)).toHaveLength(1);
  });

  it('escapes each value, and the attribute form escapes a quote too', () => {
    const xml = insertLiveItemChildren('<podcast:liveItem status="live"/>', [
      {
        ...RECORD,
        title: 'A & B <c> ]]> 🐟',
        enclosure: { url: 'https://a/"x', type: 'audio/mpeg' }
      }
    ]);

    expect(xml).toContain('<title>A &amp; B &lt;c&gt; ]]&gt; 🐟</title>');
    expect(xml).toContain('url="https://a/&quot;x"');
  });

  it('fails when the elements and the records do not match', () => {
    expect(() => insertLiveItemChildren('<podcast:liveItem status="live"/>', [])).toThrow(
      /more live item elements/
    );
    expect(() => insertLiveItemChildren('<channel/>', [RECORD])).toThrow(/0 live item elements/);
  });
});
