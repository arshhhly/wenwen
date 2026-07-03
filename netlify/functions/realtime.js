/**
 * Netlify Function: 实时到站数据
 * 路径: /api/realtime
 * 每次请求实时调用车来了API获取最新数据
 * 方向0(回家): 目标站=蔷薇路永旺梦乐城
 * 方向1(去永旺): 目标站=子期路梅林四街
 */

const { getUserId, encryptedAction } = require('../../src/chelaile');

const DIRECTION_CONFIGS = [
  { direction: 0, label: '回家', lineId: '27238438040', targetStation: { name: '蔷薇路永旺梦乐城', sId: '027-3353' } },
  { direction: 1, label: '去永旺', lineId: '27238438041', targetStation: { name: '子期路梅林四街', sId: '027-4965' } }
];

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 每个方向查不同的站点
    const directions = await Promise.all(DIRECTION_CONFIGS.map(async (config) => {
      const userId = getUserId();

      // 获取该站点的详情
      const stationDetail = await encryptedAction('bus/stop!encryptedStnDetail.action', {
        stationId: config.targetStation.sId,
        destSId: '-1'
      }, userId);

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
      }, userId);

      const buses = (lineDetail.buses || []).map(bus => {
        const order = bus.specialOrder || bus.order;
        const diff = typeof order === 'number' ? Math.abs(order - lineDetail.targetOrder) : 9999;
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        line: '637路',
        city: '武汉',
        cityId: '000',
        station: {
          name: DIRECTION_CONFIGS[1].targetStation.name,
          sId: DIRECTION_CONFIGS[1].targetStation.sId
        },
        directionStations: DIRECTION_CONFIGS.map(c => ({
          direction: c.direction,
          name: c.targetStation.name,
          sId: c.targetStation.sId
        })),
        queryTime: new Date().toISOString(),
        queryTimeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        directions
      })
    };

  } catch (error) {
    console.error('实时数据获取失败:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: '数据获取失败: ' + error.message,
        queryTime: new Date().toISOString()
      })
    };
  }
};
