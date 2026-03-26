# Fork 工作流维护手册

> 本文件仅存在于个人 fork 分支，不会提交到上游 openclaw/openclaw。

## 仓库关系

```
upstream  →  openclaw/openclaw          (主线，只读，不提交)
origin    →  wingsfly/openclaw          (个人 fork，推送目标)
本地分支  →  dev/memomind-extension     (开发分支)
```

## Remote 配置

```bash
# 查看当前配置
git remote -v

# 预期输出:
# origin    git@github.com:wingsfly/openclaw.git (fetch/push)
# upstream  https://github.com/openclaw/openclaw.git (fetch/push)
```

如果 remote 配置丢失，重新设置：
```bash
git remote add upstream https://github.com/openclaw/openclaw.git
git remote set-url origin git@github.com:wingsfly/openclaw.git
```

## 日常同步（从主线合并最新代码）

```bash
# 1. 确保在开发分支
git checkout dev/memomind-extension

# 2. 拉取主线最新代码
git fetch upstream

# 3. Rebase 到主线之上（保持线性历史）
git rebase upstream/main

# 4. 如果有冲突（通常是 generated 文件）:
#    - 重新生成: node scripts/generate-base-config-schema.ts
#    -           node scripts/generate-bundled-plugin-metadata.mjs
#    -           node scripts/generate-bundled-provider-auth-env-vars.mjs
#    - git add <冲突文件>
#    - GIT_EDITOR=true git rebase --continue

# 5. 推送到个人 fork（rebase 后需要 force push）
git push origin dev/memomind-extension --force-with-lease
```

## 提交个人开发变更

```bash
# 1. 确保在开发分支
git checkout dev/memomind-extension

# 2. 正常开发、暂存、提交
git add <files>
git commit -m "feat(extensions): <description>"

# 3. 推送到个人 fork
git push origin dev/memomind-extension
```

## 注意事项

### Pre-commit Hook
OpenClaw 仓库有严格的 pre-commit hook（`pnpm check`），包含 tsgo 类型检查。
如果存在上游已有的类型错误导致 hook 失败，可使用 `--no-verify` 跳过：
```bash
git commit --no-verify -m "feat(extensions): ..."
```

### Generated 文件
新增/修改 extension 时，以下文件会需要重新生成并一起提交：
- `src/config/schema.base.generated.ts`
- `src/plugins/bundled-plugin-metadata.generated.ts`
- `src/plugins/bundled-provider-auth-env-vars.generated.ts`

生成命令：
```bash
node --import tsx scripts/generate-base-config-schema.ts
node scripts/generate-bundled-plugin-metadata.mjs
node scripts/generate-bundled-provider-auth-env-vars.mjs
```

### 分支策略
- `main` — 保持与 upstream/main 同步，不在此分支直接开发
- `dev/memomind-extension` — 个人扩展开发分支，持续 rebase 到 upstream/main

## 个人扩展清单

| 扩展 | 目录 | 说明 |
|------|------|------|
| memory-memomind | `extensions/memory-memomind/` | MemoMind 个人信息管理集成（8 个 MCP tools） |

## 关联项目

- **MemoMind-Service**: `../MemoMind-Service/` — 后端服务（端口 8100）
- **MemoMind-Client**: `../MemoMind-Client/` — 桌面客户端
- **MemoMind 主仓库**: `git@github.com:wingsfly/MemoMind.git`
