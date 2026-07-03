/**
 * 武汉637路公交实时信息服务器（地图版）
 * 目标站点：子期路梅林四街
 * 使用车来了(Chelaile) API获取实时到站数据
 * 提供地图可视化页面，适合老人微信分享查看
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8899;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(PUBLIC_DIR, 'bus-data.json');
const ROUTE_FILE = path.join(PUBLIC_DIR, 'route-data.json');

// 车来了API配置
const CHELAILE_HOST = 'https://web.chelaile.net.cn';
const CITY_ID = '000'; // 武汉
const AES_KEY = '422556651C7F7B2B5C266EED06068230';
const MD5_SALT = 'qwihrnbtmj';
const LINE_NO = '637';
// 每个方向查不同的目标站点
const DIRECTION_CONFIGS = [
  { direction: 0, label: '回家', lineId: '27238438040', targetStation: { name: '蔷薇路永旺梦乐城', sId: '027-3353' } },
  { direction: 1, label: '去永旺', lineId: '27238438041', targetStation: { name: '子期路梅林四街', sId: '027-4965' } }
];

const SCRAPE_INTERVAL = 30 * 1000; // 30秒刷新

let userId = `browser_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
let lastScrapeTime = null;
let isScraping = false;
let cachedRealtimeData = null;
let cachedRouteData = null;

// ========== 车来了API工具函数 ==========

function md5Hex(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function decryptAes(base64) {
  const key = Buffer.from(AES_KEY, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(base64, 'base64'), decipher.final()]).toString('utf8');
}

function stripMarkers(raw) {
  return raw.trim().replace(/^\*\*YGKJ/, '').replace(/YGKJ##$/, '');
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    qs.set(key, String(value));
  });
  return qs.toString();
}

function defaultHeaders() {
  return {
    referer: `${CHELAILE_HOST}/customer_ch5/?1=1&randomTime=${Date.now()}&src=wechat_wuhan`,
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
    accept: '*/*'
  };
}

function httpsRequest(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        resolve(data);
      });
    }).on('error', reject);
  });
}

function sharedParams() {
  return {
    cityId: CITY_ID,
    s: 'h5',
    v: '9.1.2',
    vc: '1',
    src: 'wechat_wuhan',
    userId,
    h5Id: userId,
    sign: '1',
    geo_lat: '30.52',
    geo_lng: '114.23',
    lat: '30.52',
    lng: '114.23',
    gpstype: 'wgs'
  };
}

async function apiAction(handler, params) {
  const query = buildQuery({ ...params, ...sharedParams() });
  const url = `${CHELAILE_HOST}/api/${handler}?${query}`;
  const raw = await httpsRequest(url, defaultHeaders());
  const json = JSON.parse(stripMarkers(raw));
  const status = json.jsonr && json.jsonr.status;
  if (status !== '00') {
    throw new Error(json.jsonr && (json.jsonr.errmsg || json.jsonr.status) || 'Unknown API error');
  }
  return json.jsonr.data;
}

async function encryptedAction(handler, bizParams) {
  const rawSign = Object.entries(bizParams).map(([key, value]) => `${key}=${value}`).join('&');
  const cryptoSign = md5Hex(rawSign + MD5_SALT);
  const data = await apiAction(handler, { ...bizParams, cryptoSign });
  if (!data || !data.encryptResult) {
    throw new Error(`Missing encryptResult from ${handler}`);
  }
  return JSON.parse(decryptAes(data.encryptResult));
}

// ========== 获取线路站点数据 ==========

async function fetchRouteData() {
  try {
    console.log('[ROUTE] 获取637路站点数据...');

    // 637路两个方向的lineId已知，直接使用
    const lineIds = ['27238438040', '27238438041'];
    const routeResults = await Promise.all(lineIds.map(async (lineId, idx) => {
      const route = await apiAction('bus/line!lineRoute.action', { lineId });
      const stations = (route.stations || []).map(s => ({
        order: s.order,
        sn: s.sn,
        sId: s.sId,
        lat: s.lat,
        lng: s.lng,
        gpsType: s.gpsType || 'bd',
        distanceToSp: s.distanceToSp
      }));

      const startSn = route.line?.startSn || stations[0]?.sn || '-';
      const endSn = route.line?.endSn || stations[stations.length - 1]?.sn || '-';

      return {
        lineId,
        lineNo: route.line?.lineNo || route.line?.name || '637',
        direction: idx,
        directionLabel: `${startSn} → ${endSn}`,
        stationCount: stations.length,
        stations
      };
    }));

    const output = {
      line: '637路',
      city: '武汉',
      cityId: CITY_ID,
      targetStations: DIRECTION_CONFIGS.map(c => ({
        direction: c.direction,
        name: c.targetStation.name,
        sId: c.targetStation.sId
      })),
      routes: routeResults
    };

    fs.writeFileSync(ROUTE_FILE, JSON.stringify(output, null, 2));
    cachedRouteData = output;
    console.log(`[ROUTE] 站点数据获取成功，${routeResults.length}个方向`);
    for (const r of routeResults) {
      console.log(`  方向: ${r.directionLabel} (${r.stationCount}站)`);
    }
    return output;
  } catch (error) {
    console.error(`[ROUTE] 站点数据获取失败: ${error.message}`);
    return cachedRouteData;
  }
}

// ========== 获取实时到站数据 ==========

async function fetchRealtimeData() {
  if (isScraping) return cachedRealtimeData;
  isScraping = true;

  try {
    console.log(`[REALTIME] 查询637路实时数据... (${new Date().toLocaleString('zh-CN')})`);

    // 每个方向查不同的站点
    const directions = await Promise.all(DIRECTION_CONFIGS.map(async (config) => {
      // 获取该站点的详情
      const stationDetail = await encryptedAction('bus/stop!encryptedStnDetail.action', {
        stationId: config.targetStation.sId,
        destSId: '-1'
      });

      // 过滤637路且匹配lineId
      const entry = (stationDetail.lines || []).find(e => {
        const no = (e.line.lineNo || e.line.name || '').replace(/路/g, '').toLowerCase();
        return (no === '637' || no === 'r75257') && e.line.lineId === config.lineId;
      });

      if (!entry) {
        return {
          lineId: config.lineId,
          direction: config.direction,
          directionLabel: config.direction === 0
            ? '蔷薇路江堤乡新村 → 华园路知音大道口'
            : '华园路知音大道口 → 蔷薇路江堤乡新村',
          targetStation: config.targetStation.name,
          targetOrder: null,
          tip: '当前方向暂无车辆运行',
          busCount: 0,
          buses: []
        };
      }

      const lineDetail = await encryptedAction('bus/line!encryptedLineDetail.action', {
        lineId: entry.line.lineId,
        lineName: entry.line.name || entry.line.lineNo,
        direction: entry.line.direction,
        stationName: entry.targetStation.sn,
        nextStationName: entry.nextStation.sn,
        lineNo: entry.line.lineNo || entry.line.name,
        targetOrder: entry.targetStation.order
      });

      const targetOrder = entry.targetStation.order;
      const buses = (lineDetail.buses || [])
        .filter(bus => {
          const order = bus.specialOrder || bus.order;
          // 只显示还没过目标站的车（order <= targetOrder）
          return typeof order === 'number' && order <= targetOrder;
        })
        .map(bus => {
          const order = bus.specialOrder || bus.order;
          const diff = typeof order === 'number' ? targetOrder - order : 9999;
          const travelMinutes = typeof bus.travelTime === 'number' && bus.travelTime > 0
            ? Math.ceil(bus.travelTime / 60) : null;
          const distance = typeof bus.distanceToSc === 'number' && bus.distanceToSc >= 0
            ? bus.distanceToSc : null;
          return {
            busId: bus.busId || '-',
            order,
            diff,
            distance,
            travelMinutes,
            state: bus.state,
            timeStr: bus.timeStr || '-'
          };
        }).sort((a, b) => a.diff - b.diff).slice(0, 5);

      const startSn = lineDetail.line?.startSn || entry.line.startSn || '-';
      const endSn = lineDetail.line?.endSn || entry.line.endSn || '-';

      return {
        lineId: entry.line.lineId,
        direction: config.direction,
        directionLabel: `${startSn} → ${endSn}`,
        targetStation: entry.targetStation.sn,
        targetOrder: entry.targetStation.order,
        nextStation: entry.nextStation?.sn || '',
        tip: lineDetail.tip?.desc || lineDetail.line?.desc || lineDetail.line?.shortDesc || '',
        busCount: buses.length,
        buses
      };
    }));

    const output = {
      line: '637路',
      city: '武汉',
      cityId: CITY_ID,
      // 兼容前端：station字段用方向1的站点（去永旺方向）
      station: {
        name: DIRECTION_CONFIGS[1].targetStation.name,
        sId: DIRECTION_CONFIGS[1].targetStation.sId
      },
      // 新增：每个方向的目标站点信息
      directionStations: DIRECTION_CONFIGS.map(c => ({
        direction: c.direction,
        name: c.targetStation.name,
        sId: c.targetStation.sId
      })),
      queryTime: new Date().toISOString(),
      queryTimeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      directions
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));
    cachedRealtimeData = output;
    lastScrapeTime = new Date();

    console.log(`[REALTIME] 数据获取成功`);
    for (const d of directions) {
      console.log(`  方向${d.direction}: ${d.directionLabel} → 目标站: ${d.targetStation}`);
      console.log(`  提示: ${d.tip}`);
      for (const b of d.buses.slice(0, 3)) {
        const eta = b.travelMinutes ? `${b.travelMinutes}分钟` : `${b.diff}站`;
        console.log(`    车辆:${b.busId} 距离:${b.distance || '-'}m 预计:${eta} 状态:${b.state === 1 ? '停站' : '行驶'}`);
      }
    }

    return output;
  } catch (error) {
    console.error(`[REALTIME] 数据获取失败: ${error.message}`);
    return cachedRealtimeData;
  } finally {
    isScraping = false;
  }
}

// ========== HTTP服务器 ==========

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API路由
  if (req.url === '/api/realtime') {
    const data = cachedRealtimeData || fs.readFileSync(DATA_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
    return;
  }

  if (req.url === '/api/route') {
    const data = cachedRouteData || fs.readFileSync(ROUTE_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(typeof data === 'string' ? data : JSON.stringify(data));
    return;
  }

  // 静态文件服务
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, url);

  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };

  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] || 'application/octet-stream';

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1>');
  }
});

server.listen(PORT, async () => {
  console.log(`[SERVER] 637路公交实时地图服务已启动`);
  console.log(`[SERVER] http://localhost:${PORT}`);
  console.log(`[SERVER] 目标站点: 方向0→蔷薇路永旺梦乐城(回家), 方向1→子期路梅林四街(去永旺)`);
  console.log(`[SERVER] 刷新间隔: ${SCRAPE_INTERVAL / 1000}秒`);

  // 先获取路线数据（一次性）
  await fetchRouteData();

  // 再获取实时数据
  await fetchRealtimeData();

  // 定时刷新实时数据
  setInterval(fetchRealtimeData, SCRAPE_INTERVAL);
});
