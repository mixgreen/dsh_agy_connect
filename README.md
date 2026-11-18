# DSH AGY Connect

在 DeepSeek Harness 中选择 Gemini，用 Google Antigravity 个人订阅进行流式文本对话。插件通过本机官方 `agy acp` 通信，不需要 Gemini API Key，也不依赖 `dsh-tool-antigravity`。Google 登录和凭据由官方 CLI 管理。

## 安装 V 0.1.0

1. 使用 DSH `0.2.2-rc.3`，并先安装支持 `agy acp` 的[官方 CLI](https://antigravity.google/docs/install/)。本项目的起始实测环境为 macOS、`agy 1.5.11`。
2. 在 DSH 的「添加插件」粘贴以下**安装包直链**，安装并启用。无需本地编译。如果 DSH 不能访问 GitHub，先下载该文件，再把本机绝对路径填入安装框。

   ```text
   https://github.com/mixgreen/dsh_agy_connect/releases/download/V0.1.0/dsh-agy-connect-0.1.0.tgz
   ```

3. 打开 **设置 → Gemini（Antigravity CLI）**，点击 **通过 Antigravity CLI 登录 Google**；按官方客户端提示完成授权。新建文本会话，在 `agy-gemini` 下选一个当前账号可用的模型，例如 `gemini-3.8-flash-low`，发送「只回复 OK」。模型列表以官方客户端实际返回为准。

**从旧实验版迁移：** 如果装有 `dsh-tool-antigravity@0.6.3-acp.1` 或 `.2`，两者都注册 `agy-gemini`。先停用旧实验版，再启用本插件，并在新面板授权一次；不复制旧凭据。若仍需旧插件的图像或 HTTP 直连能力，请搭配不注册 `agy-gemini` 的旧插件版本（例如 `0.6.2`）。回退时先停用本插件，再启用原版本。

## 范围

支持文本历史和流式文本回复；不执行 DSH 工具、不转发附件、不生图、不轮换账号、不查询配额。官方账号权限、模型供应或服务端限流仍会影响请求。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm check
```

[项目规则](AGENTS.md) · [版本记录](CHANGELOG.md) · [范围](ROADMAP.md) · [发布说明](docs/README.md)
