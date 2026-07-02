/**
 * 武汉637路公交实时到站信息抓取器
 * 使用 Puppeteer 自动化高德地图网页版获取实时公交数据
 * 
 * 站点信息（2026年4月14日临时调整后）:
 *   - 原停靠站「芳草六街四新南路」已取消
 *   - 新增临时停靠站「四新南路梅林西路」「四新中路四新南路」
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Edge浏览器路径 (Windows)
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// 搜索关键词 - 覆盖所有可能的四新南路站点名
const SEARCH_KEYWORDS = [
  '637路 四新南路梅林西路',
  '637路 四新中路四新南路',
];

// 数据输出路径
const DATA_OUTPUT_PATH = path.join(__dirname, 'public', 'bus-data.json');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeBusData(browser) {
  const results = [];
  
  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`[INFO] 正在搜索: ${keyword}`);
    const page = await browser.newPage();
    
    try {
      // 设置视口和用户代理
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');
      
      // 拦截网络请求，寻找实时公交数据API
      const apiRequests = [];
      page.on('response', async (response) => {
        const url = response.url();
        if (url.includes('bus') || url.includes('realtime') || url.includes('station')) {
          try {
            const body = await response.text();
            apiRequests.push({ url, status: response.status(), body });
          } catch (e) {
            // 忽略无法读取的响应
          }
        }
      });
      
      // 导航到高德地图搜索页面
      const searchUrl = `https://www.amap.com/search?query=${encodeURIComponent(keyword)}&city=420100`;
      console.log(`[INFO] 访问: ${searchUrl}`);
      
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000); // 等待页面完全加载
      
      // 尝试从页面DOM提取实时公交数据
      const domData = await extractFromDOM(page);
      
      // 尝试从拦截的API请求提取数据
      const apiData = extractFromAPIRequests(apiRequests);
      
      if (domData || apiData) {
        results.push({
          keyword,
          stationName: domData?.stationName || apiData?.stationName || keyword,
          arrivals: domData?.arrivals || apiData?.arrivals || [],
          timestamp: new Date().toISOString(),
          source: domData ? 'dom' : 'api',
        });
      } else {
        results.push({
          keyword,
          stationName: keyword,
          arrivals: [],
          timestamp: new Date().toISOString(),
          source: 'none',
          note: '未能提取到实时数据，可能需要调整页面交互逻辑',
        });
      }
      
      // 保存发现的API端点供后续使用
      if (apiRequests.length > 0) {
        const endpointsFile = path.join(__dirname, 'discovered_endpoints.json');
        fs.writeFileSync(endpointsFile, JSON.stringify(apiRequests.map(r => ({
          url: r.url,
          status: r.status,
          bodyPreview: r.body?.substring(0, 500),
        })), null, 2));
        console.log(`[INFO] 发现 ${apiRequests.length} 个相关API端点，已保存到 discovered_endpoints.json`);
      }
      
    } catch (error) {
      console.error(`[ERROR] 搜索 "${keyword}" 时出错: ${error.message}`);
      results.push({
        keyword,
        stationName: keyword,
        arrivals: [],
        timestamp: new Date().toISOString(),
        source: 'error',
        error: error.message,
      });
    } finally {
      await page.close();
    }
  }
  
  return results;
}

async function extractFromDOM(page) {
  try {
    // 等待搜索结果加载
    await sleep(2000);
    
    // 尝试多种DOM选择器来提取实时公交信息
    // 高德地图的DOM结构可能随版本变化，这里尝试多种模式
    
    const data = await page.evaluate(() => {
      const result = { stationName: '', arrivals: [] };
      
      // 模式1: 搜索结果中的公交信息卡片
      const busCards = document.querySelectorAll('.bus-info-card, .route-info, .bus-line-item, [class*="bus"], [class*="route"]');
      if (busCards.length > 0) {
        for (const card of busCards) {
          const text = card.textContent;
          if (text.includes('637')) {
            // 尝试提取到站时间
            const timeMatches = text.match(/(\d+)站.*?约(\d+)分钟/g) || 
                               text.match(/(\d+)分钟/g) ||
                               text.match(/距离.*?(\d+)站/g);
            if (timeMatches) {
              result.arrivals.push({
                description: text.trim(),
                timeMatches: timeMatches,
              });
            }
          }
        }
      }
      
      // 模式2: 实时到站信息面板
      const realtimePanels = document.querySelectorAll('.realtime-info, .arrival-info, .bus-realtime, [class*="realtime"], [class*="arrival"]');
      if (realtimePanels.length > 0) {
        for (const panel of realtimePanels) {
          const text = panel.textContent;
          result.arrivals.push({
            description: text.trim(),
          });
        }
      }
      
      // 模式3: 通用搜索结果文本
      const searchResults = document.querySelectorAll('.search-result-item, .poi-item, .result-item');
      if (searchResults.length > 0) {
        for (const item of searchResults) {
          const text = item.textContent;
          if (text.includes('637') || text.includes('四新')) {
            result.stationName = text.split('\n')[0]?.trim() || '';
            result.arrivals.push({
              description: text.trim(),
            });
          }
        }
      }
      
      // 模式4: 获取页面中所有包含公交相关信息的文本
      const allText = document.body.innerText;
      if (allText.includes('637')) {
        const lines = allText.split('\n').filter(l => 
          l.includes('637') || l.includes('到站') || l.includes('分钟') || l.includes('距离')
        );
        if (lines.length > 0) {
          result.rawLines = lines;
        }
      }
      
      return result;
    });
    
    if (data.arrivals.length > 0 || data.rawLines?.length > 0) {
      return data;
    }
    
    return null;
  } catch (error) {
    console.error(`[ERROR] DOM提取失败: ${error.message}`);
    return null;
  }
}

function extractFromAPIRequests(apiRequests) {
  for (const req of apiRequests) {
    try {
      const body = JSON.parse(req.body);
      
      // 检查是否包含实时公交到站信息
      if (body.data?.businfo || body.data?.realtime || body.data?.arrival) {
        return {
          stationName: body.data?.name || '',
          arrivals: Array.isArray(body.data?.businfo) ? body.data.businfo : 
                    Array.isArray(body.data?.realtime) ? body.data.realtime : [],
          rawBody: body,
        };
      }
      
      // 检查高德地图标准返回格式
      if (body.busstops || body.buslines) {
        const stationInfo = body.busstops?.find(s => 
          s.name?.includes('四新南路') || s.name?.includes('637')
        );
        if (stationInfo) {
          return {
            stationName: stationInfo.name,
            arrivals: stationInfo.buslines || [],
            rawBody: body,
          };
        }
      }
    } catch (e) {
      // 不是JSON格式，忽略
    }
  }
  return null;
}

async function main() {
  console.log('[INFO] 启动武汉637路公交实时数据抓取器...');
  console.log('[INFO] 浏览器路径: ' + EDGE_PATH);
  
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
      ],
    });
    
    console.log('[INFO] 浏览器已启动');
    
    const results = await scrapeBusData(browser);
    
    // 合并结果并保存
    const output = {
      line: '637路',
      city: '武汉',
      queryTime: new Date().toISOString(),
      queryTimeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      stations: results,
      note: '2026年4月14日起因芳草六街施工，637路临时调整：取消芳草六街四新南路站，新增四新南路梅林西路、四新中路四新南路站',
    };
    
    fs.writeFileSync(DATA_OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`[INFO] 数据已保存到 ${DATA_OUTPUT_PATH}`);
    
    // 输出摘要
    console.log('\n========== 抓取结果摘要 ==========');
    for (const r of results) {
      console.log(`站点: ${r.stationName}`);
      console.log(`到站信息: ${r.arrivals.length > 0 ? JSON.stringify(r.arrivals) : '暂无数据'}`);
      console.log(`数据来源: ${r.source}`);
    }
    console.log('===================================\n');
    
  } catch (error) {
    console.error(`[ERROR] 程序出错: ${error.message}`);
    
    // 即使出错也保存错误信息
    const errorOutput = {
      line: '637路',
      city: '武汉',
      queryTime: new Date().toISOString(),
      queryTimeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      error: error.message,
      stations: [],
    };
    fs.writeFileSync(DATA_OUTPUT_PATH, JSON.stringify(errorOutput, null, 2));
  } finally {
    if (browser) {
      await browser.close();
      console.log('[INFO] 浏览器已关闭');
    }
  }
}

main().catch(console.error);
