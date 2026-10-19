import { describe, expect, it } from 'vitest';
import { flexHtml } from './flexHtml';

describe('flexHtml', () => {
  it('converts font, bold and line breaks', () => {
    expect(flexHtml("<font size='16' color='#FF0000'>司隶</font>\n<b>x</b><br/>")).toBe(
      '<span style="color:#ff0000;font-size:16px">司隶</span><br><b>x</b><br>',
    );
  });

  it('escapes text and drops unsafe markup', () => {
    expect(flexHtml('<script>alert(1)</script><img src=x onerror=y>a & b')).toBe(
      'alert(1)a &amp; b',
    );
    expect(flexHtml('<font color="red;background:url(x)">t</font>')).toBe('<span>t</span>');
    expect(flexHtml('1 < 2 &lt;tag&gt;')).toBe('1 &lt; 2 &lt;tag&gt;');
  });

  it('maps links', () => {
    expect(flexHtml('<a href="event:city_1">c</a>')).toBe('<a data-event="city_1">c</a>');
    expect(flexHtml('<a href="http://x.cn/?a=1&b=2">h</a>')).toBe(
      '<a href="http://x.cn/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">h</a>',
    );
    expect(flexHtml('<a href="javascript:alert(1)">j</a>')).toBe('<a>j</a>');
  });

  it('closes unbalanced tags', () => {
    expect(flexHtml('<b><u>x</b>y</u><p align="center">z')).toBe(
      '<b><u>x</u></b>y<div style="text-align:center">z</div>',
    );
  });
});
