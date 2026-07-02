/**
 * 车来了(Chelaile) API 工具模块
 * 用于Vercel Serverless Functions
 */

const crypto = require('crypto');
const https = require('https');

const CHELAILE_HOST = 'https://web.chelaile.net.cn';
const AES_KEY = '422556651C7F7B2B5C266EED06068230';
const MD5_SALT = 'qwihrnbtmj';
const CITY_ID = '000'; // 武汉

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

function getUserId() {
  return `vercel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sharedParams(userId) {
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

async function apiAction(handler, params, userId) {
  const query = buildQuery({ ...params, ...sharedParams(userId) });
  const url = `${CHELAILE_HOST}/api/${handler}?${query}`;
  const raw = await httpsRequest(url, defaultHeaders());
  const json = JSON.parse(stripMarkers(raw));
  const status = json.jsonr && json.jsonr.status;
  if (status !== '00') {
    throw new Error(json.jsonr && (json.jsonr.errmsg || json.jsonr.status) || 'Unknown API error');
  }
  return json.jsonr.data;
}

async function encryptedAction(handler, bizParams, userId) {
  const rawSign = Object.entries(bizParams).map(([key, value]) => `${key}=${value}`).join('&');
  const cryptoSign = md5Hex(rawSign + MD5_SALT);
  const data = await apiAction(handler, { ...bizParams, cryptoSign }, userId);
  if (!data || !data.encryptResult) {
    throw new Error(`Missing encryptResult from ${handler}`);
  }
  return JSON.parse(decryptAes(data.encryptResult));
}

module.exports = {
  CHELAILE_HOST, CITY_ID, AES_KEY, MD5_SALT,
  md5Hex, decryptAes, stripMarkers, buildQuery,
  defaultHeaders, httpsRequest, getUserId, sharedParams,
  apiAction, encryptedAction
};
