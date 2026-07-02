/**
 * Vercel Serverless Function: 线路站点数据
 * 路径: /api/route
 * 返回637路所有站点的坐标和名称
 */

const { getUserId, apiAction } = require('./chelaile');

// 637路两个方向的lineId
const LINE_IDS = ['27238438040', '27238438041'];
const TARGET_STATION = { name: '子期路梅林四街', sId: '027-4965' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // 线路数据缓存1天

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const userId = getUserId();

    const routeResults = await Promise.all(LINE_IDS.map(async (lineId, idx) => {
      const route = await apiAction('bus/line!lineRoute.action', { lineId }, userId);
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

    return res.status(200).json({
      line: '637路',
      city: '武汉',
      cityId: '000',
      targetStation: {
        name: TARGET_STATION.name,
        sId: TARGET_STATION.sId
      },
      routes: routeResults
    });

  } catch (error) {
    console.error('线路数据获取失败:', error.message);
    return res.status(500).json({
      error: '线路数据获取失败: ' + error.message
    });
  }
};
