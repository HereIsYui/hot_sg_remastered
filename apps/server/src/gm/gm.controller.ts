import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { GmTokenGuard } from './gm-token.guard';
import { GmCommands } from './gm.commands';

type Row = Record<string, unknown>;

/**
 * The GM ops API under `api/gm`. Deliberately a plain Nest controller instead of the command
 * gateway: no session, no openfunc whitelist. Reads are GET, writes are POST; the body/query
 * values are parsed here so GmCommands works on plain numbers and keeps its unit tests simple.
 */
@Controller('api/gm')
@UseGuards(GmTokenGuard)
export class GmController {
  constructor(private readonly gm: GmCommands) {}

  // ---------------------------------------------------------------- players

  @Get('player/search')
  searchPlayers(@Query('by') by: string, @Query('name') name: string): Promise<Row[]> {
    return this.gm.searchPlayers(by === 'passport' ? 'passport' : 'name', String(name ?? ''));
  }

  @Post('player/property')
  updatePlayer(
    @Body()
    body: {
      uid: number;
      money?: number;
      gift?: number;
      prestige?: number;
      nobility?: number;
      officepos?: number;
    },
  ): Promise<Row> {
    return this.gm.updatePlayer({
      uid: int(body.uid),
      money: optNumber(body.money),
      gift: optNumber(body.gift),
      prestige: optNumber(body.prestige),
      nobility: optNumber(body.nobility),
      officepos: optNumber(body.officepos),
    });
  }

  @Get('player/forbidden')
  forbidList(): Promise<Row[]> {
    return this.gm.forbidList();
  }

  @Post('player/forbid')
  forbidUser(@Body() body: { uid: number; delemail?: boolean }): Promise<Row> {
    return this.gm.forbidUser({ uid: int(body.uid), delemail: body.delemail === true });
  }

  @Post('player/unforbid')
  unforbidUser(@Body() body: { uid: number }): Promise<Row> {
    return this.gm.unforbidUser(int(body.uid));
  }

  // ---------------------------------------------------------------- cities

  @Get('city/search')
  searchCities(
    @Query('name') name: string,
    @Query('x') x: string,
    @Query('y') y: string,
  ): Promise<Row[]> {
    return this.gm.searchCities({
      name: name === undefined ? undefined : String(name),
      x: optInt(x),
      y: optInt(y),
    });
  }

  @Post('city/max-level')
  cityMaxLevel(@Body() body: { cid: number }): Promise<{ buildings: number; technics: number }> {
    return this.gm.cityMaxLevel(int(body.cid));
  }

  @Post('city/clean')
  cleanupUser(@Body() body: { uid: number; confirm?: boolean }): Promise<{ ok: true }> {
    return this.gm.cleanupUser({ uid: int(body.uid), confirm: body.confirm === true });
  }

  // ---------------------------------------------------------------- heroes

  @Get('hero/search')
  searchHeroes(@Query('name') name: string): Promise<{ heroes: Row[]; npcHeroes: Row[] }> {
    return this.gm.searchHeroes(String(name ?? ''));
  }

  @Post('hero/property')
  updateHero(
    @Body()
    body: {
      hid: number;
      level?: number;
      exp?: number;
      command?: number;
      affairs?: number;
      bravery?: number;
      wisdom?: number;
    },
  ): Promise<Row> {
    return this.gm.updateHero({
      hid: int(body.hid),
      level: optNumber(body.level),
      exp: optNumber(body.exp),
      command: optNumber(body.command),
      affairs: optNumber(body.affairs),
      bravery: optNumber(body.bravery),
      wisdom: optNumber(body.wisdom),
    });
  }

  @Post('hero/place')
  placeHero(@Body() body: { hid: number; cid: number }): Promise<Row> {
    return this.gm.placeHero({ hid: int(body.hid), cid: int(body.cid) });
  }

  // ---------------------------------------------------------------- goods

  @Get('goods/search')
  searchGoods(@Query('kind') kind: string, @Query('name') name: string): Promise<Row[]> {
    return this.gm.searchGoods(kind === 'armor' ? 'armor' : 'goods', String(name ?? ''));
  }

  @Post('goods/grant')
  grantGoods(@Body() body: { uid: number; gid: number; count?: number }): Promise<{ ok: true }> {
    return this.gm.grantGoods({
      uid: int(body.uid),
      gid: int(body.gid),
      count: body.count === undefined ? 1 : int(body.count),
    });
  }

  @Post('goods/remove')
  removeGoods(@Body() body: { uid: number; gid: number; count?: number }): Promise<{ ok: true }> {
    return this.gm.removeGoods({
      uid: int(body.uid),
      gid: int(body.gid),
      count: body.count === undefined ? undefined : int(body.count),
    });
  }

  // ---------------------------------------------------------------- announce

  @Post('announce/inform')
  sendInform(
    @Body()
    body: {
      msg: string;
      color?: number;
      seconds?: number;
      type?: number;
    },
  ): Promise<{ ok: true }> {
    return this.gm.sendInform({
      msg: String(body.msg ?? ''),
      color: optNumber(body.color),
      seconds: optNumber(body.seconds),
      type: optNumber(body.type),
    });
  }

  @Post('announce/speak')
  speak(@Body() body: { msg: string; from?: string }): Promise<number> {
    return this.gm.speak({ msg: String(body.msg ?? ''), from: body.from });
  }

  @Get('announce/login')
  loginAnnounce(): Promise<{ announce: Row | null; content: string }> {
    return this.gm.loginAnnounce();
  }

  @Post('announce/login')
  setLoginAnnounce(
    @Body()
    body: {
      maxname?: string;
      maxpos?: string;
      maxnob?: string;
      maxattack?: string;
      maxdefence?: string;
      content?: string;
    },
  ): Promise<{ announce: Row | null; content: string }> {
    return this.gm.setLoginAnnounce({
      maxname: optString(body.maxname),
      maxpos: optString(body.maxpos),
      maxnob: optString(body.maxnob),
      maxattack: optString(body.maxattack),
      maxdefence: optString(body.maxdefence),
      content: optString(body.content),
    });
  }

  // ---------------------------------------------------------------- game state (mem_state)

  @Get('state/list')
  listState(@Query('state') state: string): Promise<Row[]> {
    return this.gm.listState(optInt(state));
  }

  @Post('state/set')
  setState(@Body() body: { state: number; value: number; description?: string }): Promise<Row> {
    return this.gm.setState({
      state: int(body.state),
      value: optNumber(body.value) ?? 0,
      description: optString(body.description),
    });
  }

  // ---------------------------------------------------------------- tasks (epic)

  @Get('task/epic')
  epicTasks(@Query('uid') uid: string): Promise<Row[]> {
    return this.gm.epicTasks(int(uid));
  }

  @Post('task/epic')
  setEpicTask(
    @Body()
    body: {
      uid: number;
      gid?: number;
      currentcount?: number;
      tid?: number;
      state?: number;
    },
  ): Promise<Row> {
    return this.gm.setEpicTask({
      uid: int(body.uid),
      gid: optInt(body.gid),
      currentcount: optNumber(body.currentcount),
      tid: optInt(body.tid),
      state: optNumber(body.state),
    });
  }

  // ---------------------------------------------------------------- world

  @Post('world/refresh')
  refreshWilds(): Promise<{ touched: number }> {
    return this.gm.refreshWilds();
  }

  @Get('world/status')
  status(): Promise<{ online: number; onlineUids: number[]; tables: Row[] }> {
    return this.gm.status();
  }
}

function int(value: unknown): number {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function optInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return int(value);
}

function optNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `''` stays a real value (clearing a text field), only null/undefined mean "not given". */
function optString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}
