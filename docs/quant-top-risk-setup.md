# 短期拥挤与顶部风险：自动更新配置

页面在没有配置定时任务时，会回退读取 JunQuant 的公开实时评分接口。配置完成后，页面会优先读取本项目 Firebase 中的最新评分和历史曲线。

## GitHub Secrets

在仓库的 `Settings > Secrets and variables > Actions` 中添加：

### `FIREBASE_SERVICE_ACCOUNT_JSON`

Firebase 服务账号 JSON 的完整内容。该账号需要对项目 Firestore 拥有写入权限。

### `NEXT_PUBLIC_APP_ID`

与 Vercel 环境变量 `NEXT_PUBLIC_APP_ID` 相同的值。没有显式配置时，项目默认使用 `default-app`。

## Firestore 路径

工作流写入：

```text
artifacts/{APP_ID}/public/data/quant_us_top_risk/latest
artifacts/{APP_ID}/public/data/quant_us_top_risk/history
```

`latest` 保存当前评分和五个子信号；`history` 保存最近约 756 个交易日的评分及 NDX 标准化对照数据。

## 自动运行

工作流文件：

```text
.github/workflows/update-us-top-risk.yml
```

默认在中国时间工作日早上 06:30 运行，也支持 GitHub Actions 页面手动执行。

首次运行会回填十年历史数据，通常需要 5 至 15 分钟。后续运行通过 GitHub Actions cache 恢复 SQLite 数据库并执行增量更新。

## 本地验证

安装依赖：

```bash
pip install -r quant-engines/us-top-risk/requirements-sync.txt
```

准备数据后，可先不写入 Firebase：

```bash
python scripts/sync_top_risk_to_firebase.py \
  --engine-root quant-engines/us-top-risk \
  --dry-run
```

## 上游版权

核心研究引擎来自：

```text
https://github.com/junqt/junquant-research/tree/main/us-market/01_top_risk_score
```

采用 MIT License。原许可证保存在：

```text
quant-engines/us-top-risk/LICENSE
```

