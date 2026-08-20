# Docker Compose 自托管

Docker 是源码工作区中的高级自托管入口，仍需预先安装并启动 Docker Desktop 或 Docker Engine。桌面发行包不包含 Docker 构建上下文。

开始前确认：

- Docker Engine/Desktop 正在运行，并支持 Compose v2；
- 4318 端口没有被其他服务占用；
- 仓库根目录可以创建仅本机使用的 `.env.local` 和 `data/backups/`；
- 如果要从其他设备访问，已经准备好 TLS、反向代理、访问控制和独立备份位置。

Windows 可运行：

```powershell
powershell -File scripts/docker-start.ps1
```

脚本会检查 Docker、在 `.env.local` 中生成本地认证令牌、启动 Compose、等待健康检查并打开浏览器。也可以手动执行：

```bash
docker compose up -d --build
```

访问 `http://127.0.0.1:4318`。Server 不直接发布宿主端口，Nginx 同源代理 `/api` 并注入认证令牌。作品保存在 `narralume-data` 卷，备份写入 `${NARRATIVE_BACKUP_HOST_DIR:-./data/backups}`。

确认运行状态：

```bash
docker compose ps
docker compose logs --tail 100 server web
```

健康检查地址是 `http://127.0.0.1:4318/api/health`。不要把日志中的令牌、模型请求或正文贴到公开 Issue。

常用维护入口：

```powershell
# 创建在线一致性备份；文件写入独立挂载的 backups 目录
powershell -File scripts/docker-backup.ps1
# 拉取干净源码工作区的更新、重建并等待健康检查
powershell -File scripts/docker-update.ps1
# 停止容器但保留数据卷
powershell -File scripts/docker-stop.ps1
```

更新脚本只接受没有本地改动的 Git 工作区，会执行快进拉取、重新构建镜像并等待健康检查。它不会替你创建备份；更新前先运行 `docker-backup.ps1`，并确认备份文件确实出现在宿主机目录。

Linux/macOS 可以使用对应的 Compose 命令：

```bash
docker compose build --pull
docker compose up -d
docker compose down
```

`docker compose down` 会停止并移除容器，但保留命名数据卷。重新启动后，先核对作品数量和最近正文版本，再继续写作。

不要使用 `docker compose down --volumes`，除非明确要删除全部作品数据。将 Web 端口暴露到局域网或公网前，必须使用高熵 `NARRATIVE_AUTH_TOKEN`、TLS、访问控制和独立备份目录。

更多环境变量见[配置](configuration.md)，备份与恢复步骤见[数据、隐私与备份](data-and-backup.md)。
