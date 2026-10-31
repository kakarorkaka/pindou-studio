# 混元生图代理（本地）

混元接口需要 Bearer API Key，**Key 不能放进前端**。这个代理只监听 `127.0.0.1:8788`，Key 只留在本机。

## 启动

```bash
cd site
node tools/hunyuan-proxy.mjs
```

打开 <http://127.0.0.1:8124/index.html>，上传图片后点「AI 风格化」。

## Key 读取顺序

1. 环境变量 `HUNYUAN_API_KEY`
2. 环境变量 `KOK_IMAGE_GEN_API_KEY`
3. KOK 的 UserDefaults：`Translator-App.KoK` → `image_gen_api_key`
4. `~/.config/pindou/hunyuan-key`（文件里只放 Key）
5. `site/.env.local` 里的 `HUNYUAN_API_KEY=...`（已 gitignore）

推荐直接在 KOK 设置里填一次生图 Key，代理会自动读取；也可以：

```bash
HUNYUAN_API_KEY=sk-... node tools/hunyuan-proxy.mjs
```

## 联调模式（不消耗额度）

```bash
HUNYUAN_MOCK=1 node tools/hunyuan-proxy.mjs
```

Mock 会把原图原样返回，只用于验证前端链路。

## 线上页面

GitHub Pages 是 HTTPS，浏览器允许调用 `http://127.0.0.1:8788`（localhost 例外），所以线上页面 + 本地代理可以直接用。代理 CORS 白名单包含：

- `https://kakarorkaka.github.io`
- `http://localhost:*`
- `http://127.0.0.1:*`
- `file://`（Origin: null）

## 生产部署

把同样的 `/health`、`/api/ai/stylize` 逻辑部署到 Cloudflare Worker / 腾讯云函数，用环境变量保存 Key；前端把代理地址填到 AI 面板的「服务地址」即可。不要把 Key 写进任何提交到仓库的文件。
