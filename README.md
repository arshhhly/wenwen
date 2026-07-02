# 武汉637路公交实时到站监控

目标站点：子期路梅林四街

## 本地运行

```bash
node server.js
```

访问 http://localhost:8899

## 部署到 Render.com

1. 将本项目推到 GitHub
2. 在 Render.com 创建新的 Web Service
3. 连接 GitHub 仓库
4. Build Command: 空（无需构建）
5. Start Command: `node server.js`
6. 选择免费套餐

## 文件说明

- `server.js` - Node.js HTTP服务器，调用车来了API获取实时数据，提供API和静态文件服务
- `public/index.html` - 前端页面，含地图、路线轨迹、实时车辆位置
- `chelaile-fast.js` - 车来了API命令行工具（开发调试用）
- `package.json` - 项目配置
