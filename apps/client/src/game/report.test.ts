import { describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import {
  makeEndTimeString,
  parseReportDetail,
  parseReportItem,
  parseReportList,
  reportColor,
  reportPageLabel,
  reportTitleName,
} from './report';

setStrings({
  Report_ReportListPanelSrc_3: '占领战报', // title 2
  Report_ReportListPanelSrc_47: '野外',
  Report_ReportListPanelSrc_48: '未知',
  Report_ReportListPanelSrc_49: '系统',
});

describe('reportTitleName', () => {
  it('reads REPORT_TITLE[title] (1-based i18n key)', () => {
    expect(reportTitleName(2)).toBe('占领战报');
  });
});

describe('reportColor', () => {
  it('title 50 is red; the table drives the rest; unknown is white', () => {
    expect(reportColor(50)).toBe(0xff0000);
    expect(reportColor(0)).toBe(0xffffff);
    expect(reportColor(5)).toBe(0xffff00);
    expect(reportColor(999)).toBe(0xffffff);
  });
});

describe('makeEndTimeString', () => {
  it('formats a unix time as YYYY-MM-DD HH:MM:SS', () => {
    const ts = Math.floor(new Date(2026, 9, 23, 4, 8, 9).getTime() / 1000);
    expect(makeEndTimeString(ts)).toBe('2026-10-23 04:08:09');
  });
});

describe('parseReportItem', () => {
  it('decorates title, bold (unread), colour, cities and makeCid', () => {
    const item = parseReportItem({
      id: 50,
      title: 2,
      type: 0,
      read: 0,
      origincid: 215265,
      happencid: 100200,
      origincity: '洛阳',
      happencity: '',
      battleid: 7,
      from_battlenet: 0,
      time: 0,
      content: '<b>x</b>',
    });
    expect(item.titleName).toBe('占领战报');
    expect(item.bold).toBe(true);
    expect(item.battleid).toBe(7);
    expect(item.origincity).toBe('洛阳');
    expect(item.happencity).toBe('未知'); // blank -> fallback
    expect(item.fromcid).toBe('[265,215]');
    expect(item.selected).toBe(false);
  });

  it('a read report is not bold; origincid 0 shows the 系统 label', () => {
    const item = parseReportItem({ id: 1, title: 0, read: 1, origincid: 0, happencid: 0, time: 0 });
    expect(item.bold).toBe(false);
    expect(item.fromcid).toBe('系统');
    expect(item.origincity).toBe('野外'); // blank origin -> fallback
  });
});

describe('parseReportList', () => {
  it('decodes [pageCount, page, rows]', () => {
    const reply = parseReportList([
      3,
      1,
      [
        { id: 1, read: 0 },
        { id: 2, read: 1 },
      ],
    ]);
    expect(reply.pageCount).toBe(3);
    expect(reply.page).toBe(1);
    expect(reply.items).toHaveLength(2);
  });

  it('tolerates a malformed reply', () => {
    expect(parseReportList(null).items).toEqual([]);
  });
});

describe('parseReportDetail', () => {
  it('concatenates ordered round HTML into one body', () => {
    const { rounds, html } = parseReportDetail([
      [
        { round: 1, report: '<p>round1</p>' },
        { round: 2, report: '<p>round2</p>' },
      ],
    ]);
    expect(rounds).toHaveLength(2);
    expect(html).toBe('<p>round1</p><p>round2</p>');
  });

  it('is empty for a non-battle report', () => {
    expect(parseReportDetail([]).html).toBe('');
  });
});

describe('reportPageLabel', () => {
  it('is 1-based, 0/0 when empty', () => {
    expect(reportPageLabel(3, 1)).toBe('2/3');
    expect(reportPageLabel(0, 0)).toBe('0/0');
  });
});
