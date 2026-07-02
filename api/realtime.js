/**
 * Vercel Serverless Function: 实时到站数据
 * 路径: /api/realtime
 * 每次请求实时调用车来了API获取最新数据
 */

const { getUserId, encryptedAction, apiAction } = require('./chelaile');

const TARGET_STATION = { name: '子期路梅林四街', sId: '027-4965' };

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const userId = getUserId();

    // 获取站点详情
    const stationDetail = await encryptedAction('bus/stop!encryptedStnDetail.action', {
      stationId: TARGET_STATION.sId,
      destSId: '-1'
    }, userId);

    // 过滤637路
    const lines = (stationDetail.lines || []).filter(entry => {
      const no = (entry.line.lineNo || entry.line.name || '').replace(/路/g, '').toLowerCase();
      return no === '637' || no === 'r75257';
    });

    if (lines.length === 0) {
      return res.status(200).json({
        line: '637路', city: '武汉', cityId: '000',
        station: { name: TARGET_STATION.name, sId: TARGET_STATION.sId },
        queryTime: new Date().toISOString(),
        queryTimeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        directions: [],
        error: '未找到637路数据，可能当前无车辆运行'
      });
    }

    // 获取每个方向的实时数据
    const directions = await Promise.all(lines.map(async (entry) => {
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
        direction: entry.line.direction,
        directionLabel: `${startSn} → ${endSn}`,
        targetStation: entry.targetStation.sn,
        targetOrder: entry.targetStation.order,
        nextStation: entry.nextStation?.sn || '',
        tip: lineDetail.tip?.desc || lineDetail.line?.desc || lineDetail.line?.shortDesc || '',
        busCount: buses.length,
        buses
      };
    }));

    return res.status(200).json({
      line: '637路',
      city: '武汉',
      cityId: '000',
      station: {
        name: stationDetail.sn || TARGET_STATION.name,
        sId: stationDetail.sId || TARGET_STATION.sId
      },
      queryTime: new Date().toISOString(),
      queryTimeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      directions
    });

  } catch (error) {
    console.error('实时数据获取失败:', error.message);
    return res.status(500).json({
      error: '数据获取失败: ' + error.message,
      queryTime: new Date().toISOString()
    });
  }
};
