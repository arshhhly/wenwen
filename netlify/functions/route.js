/**
 * Netlify Function: 线路站点数据
 * 路径: /api/route
 * 返回637路所有站点的坐标和名称
 */

const { getUserId, apiAction } = require('../../src/chelaile');

// 637路两个方向的lineId
const LINE_IDS = ['27238438040', '27238438041'];
// 每个方向的目标站点
const TARGET_STATIONS = [
  { direction: 0, name: '蔷薇路永旺梦乐城', sId: '027-3353' },
  { direction: 1, name: '子期路梅林四街', sId: '027-4965' }
];

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=86400',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        line: '637路',
        city: '武汉',
        cityId: '000',
        targetStations: TARGET_STATIONS,
        routes: routeResults
      })
    };

  } catch (error) {
    console.error('线路数据获取失败:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: '线路数据获取失败: ' + error.message
      })
    };
  }
};
