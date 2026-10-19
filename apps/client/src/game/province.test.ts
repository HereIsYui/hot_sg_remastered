import { beforeAll, describe, expect, it } from 'vitest';
import { setStrings } from '../i18n';
import { validateLordName } from './createRole';
import { provinceInfo, provinceOptions } from './province';

beforeAll(() => {
  setStrings({
    Login_CreateRoleDialogSrc_1: '随机',
    _Global_2: '司隶',
    _Global_3: '冀州',
    _Global_2298: "系统会 <font size='16'>随机</font> 选择一个州",
    _Global_2299: '</font> 的城池情况:\n君主数:',
    _Global_2300: '城池数:',
    _Global_2301: "拥挤度:<font color='#00FF00'>",
    _Global_2302: "拥挤度:<font color='#FFFF00'>",
    _Global_2303: "拥挤度:<font color='#FF0000'>",
  });
});

describe('province', () => {
  it('lists random plus thirteen provinces', () => {
    const options = provinceOptions();
    expect(options).toHaveLength(14);
    expect(options.slice(0, 3)).toEqual(['随机', '司隶', '冀州']);
  });

  it('describes crowding like Global.getProvinceInfo', () => {
    const counts = { users: [5, 1], cities: [45, 1], lands: [100, 10] };
    expect(provinceInfo(1, counts)).toBe(
      "<font size='16'>司隶</font> 的城池情况:\n君主数:5\n城池数:45\n拥挤度:<font color='#FFFF00'>45%</font>",
    );
    expect(provinceInfo(2, counts)).toContain("#00FF00'>10%");
    expect(provinceInfo(0, counts)).toContain('随机');
    expect(provinceInfo(1, { users: [], cities: [], lands: [] })).toBe('');
  });
});

describe('validateLordName', () => {
  it('applies the client-side rules in order', () => {
    expect(validateLordName('')).toBe('Login_CreateRoleDialogSrc_2');
    expect(validateLordName('一二三四五六七八九十十')).toBe('Login_CreateRoleDialogSrc_3');
    expect(validateLordName('风')).toBe('Login_CreateRoleDialogSrc_4');
    expect(validateLordName('风\r云')).toBe('Login_CreateRoleDialogSrc_5');
    expect(validateLordName('风云子')).toBeNull();
  });
});
