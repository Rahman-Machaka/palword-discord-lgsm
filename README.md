# Palworld Server Discord Command Bot (LinuxGSM)

A Discord bot for monitoring and controlling a Palworld dedicated server with LinuxGSM. It maintains a status message in a Discord channel and provides authorized users with buttons for common server operations.

## Table of Contents

- [Features](#features)
- [How it works](#how-it-works)
- [Owner maintenance](#owner-maintenance)
- [Audit log and automatic update checks](#audit-log-and-automatic-update-checks)
- [Runtime and PM2 error alerts](#runtime-and-pm2-error-alerts)
- [Diagnostics](#diagnostics)
- [Requirements](#requirements)
- [Discord bot setup](#discord-bot-setup)
- [Palworld REST API setup](#palworld-rest-api-setup)
- [Local and remote server execution](#local-and-remote-server-execution)
- [Installation](#installation)
- [Configuration](#configuration)
- [Feature flags](#feature-flags)
- [Languages and localization](#languages-and-localization)
- [Running the bot](#running-the-bot)
- [Running with PM2](#running-with-pm2)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Security](#security)

## Features

- Live Palworld server dashboard built with Discord Components V2
- Current player count, player list, server FPS, uptime, world day, and version
- Start and stop through LinuxGSM
- Save the world through the Palworld REST API
- Safe restart flow: save, stop, wait for offline, start, wait for online
- In-game announcements through a Discord modal
- Manual and automatic status refresh
- User allowlist for all server controls
- English and German user interfaces
- Persistent status message instead of sending a new message after every restart
- Protection against concurrent server actions
- Owner-only `/maintenance` commands for bot, Palworld, and LinuxGSM maintenance
- Palworld-specific audit entries for server and maintenance actions
- Automatic update checks with deduplicated owner notifications
- Owner pings for runtime errors and unexpected PM2 restarts
- Owner-only `/diagnostics` command with read-only system checks

## How it works

The bot connects to Discord through the Gateway API. It reads server information from the local Palworld REST API and starts or stops the server through LinuxGSM. The persistent dashboard uses a colored Components V2 container and only shows controls that make sense for the current server state.

The following controls are available:

| Control | Behavior |
| --- | --- |
| Start server | Starts an offline server through LinuxGSM |
| Stop server | Saves the world, waits 10 seconds, and stops the server |
| Save server | Saves the world through `POST /v1/api/save` |
| Restart server | Saves, stops, waits for offline, starts, and waits for online |
| Refresh | Refreshes the Discord status message |
| More actions → Send announcement | Opens a modal and sends up to 500 characters through `POST /v1/api/announce` |
| `/maintenance update-bot` | Runs a fast-forward-only Git pull, installs locked dependencies, and restarts the PM2 process |
| More actions → Check updates | Checks Palworld without changing it and compares the installed LinuxGSM version with the latest release |
| `/maintenance install-updates` | Updates LinuxGSM and then updates Palworld; LinuxGSM restarts the game server when required |

Server actions are disabled when the server state cannot be determined safely.

When upgrading from the older embed layout, the bot creates the Components V2 dashboard, stores its new message ID, and removes the legacy status message. Legacy maintenance buttons no longer execute actions and direct the owner to the corresponding slash command or dashboard menu instead.

## Owner maintenance

Modifying maintenance actions are provided as `/maintenance` slash commands instead of buttons in the shared dashboard. The non-modifying update check is available under **More actions**. Every maintenance interaction and confirmation is checked server-side against `DISCORD_OWNER_USER_ID`. Other users cannot execute these actions.

The two modifying actions require an additional ephemeral confirmation:

- `/maintenance update-bot` verifies that the configured PM2 process exists, rejects tracked local Git changes, runs `git pull --ff-only`, runs `npm ci --omit=dev`, sends Discord feedback, and then applies the complete PM2 ecosystem so the bot and monitor use the new code.
- `/maintenance install-updates` runs the official LinuxGSM `update-lgsm` command followed by `update`. If a Palworld update is available while the server is running, LinuxGSM may restart it.

**More actions → Check updates** runs LinuxGSM `check-update` for Palworld. Since LinuxGSM does not provide a documented check-only command for its own updater, the bot reads the installed LinuxGSM version and compares it with the latest official GitHub release.

These actions share a lock with start, stop, save, restart, and announcement operations. Only one server or maintenance action can run at a time.

Official LinuxGSM references:

- [Check for a game server update](https://docs.linuxgsm.com/commands/check-update)
- [Update a game server](https://docs.linuxgsm.com/commands/update)
- [LinuxGSM command list](https://docs.linuxgsm.com/commands)

## Audit log and automatic update checks

Server controls, announcements, maintenance actions, diagnostics, denied access attempts, cancellations, and failures are written to `PALWORLD_AUDIT_LOG_CHANNEL_ID`. Every entry starts with **Palworld Server** in its title so the channel can be shared with logs from other game servers.

The default audit channel is `1270734893013405746`. Audit delivery is isolated from the original action: a missing permission or unavailable audit channel does not prevent a server action from completing.

When `FEATURE_AUTO_UPDATE_CHECK_ENABLED=true`, the bot runs the non-modifying LinuxGSM `check-update` command and checks the latest LinuxGSM release once per hour by default. If either Palworld or LinuxGSM has an update, the bot sends a notification to the same audit channel and mentions `DISCORD_OWNER_USER_ID`.

The same detected update is announced only once while the bot is running. A later check without an available update resets this state, allowing a future update to notify again. The interval can be changed with `PALWORLD_AUTO_UPDATE_CHECK_INTERVAL_MS`.

## Runtime and PM2 error alerts

When `FEATURE_RUNTIME_ERROR_ALERTS_ENABLED=true`, the bot and its independent PM2 monitor mention `DISCORD_OWNER_USER_ID` in `PALWORLD_AUDIT_LOG_CHANNEL_ID` for:

- startup failures, including failures before the Discord Gateway login completes
- uncaught exceptions and unhandled promise rejections
- Discord client errors
- failed slash-command registration and background status updates
- failed PM2 monitoring
- an unexpected increase of the configured PM2 process restart counter
- a persistent PM2 state of `errored` or `stopped`

Alerts are sent directly through the Discord REST API with the existing bot token. No webhook is required. Repeated identical background or PM2-status errors are limited by `PALWORLD_RUNTIME_ALERT_COOLDOWN_MS`, which defaults to five minutes. Uncaught process-fatal errors and newly detected PM2 restarts bypass this cooldown.

The separate `command-bot-monitor` task checks PM2 every 15 seconds by default. Its first successful check establishes a baseline in `palworld-pm2-alert-state.json`. Future restart-count increases and unhealthy states trigger an alert even if the main bot can no longer start. Change the interval with `PALWORLD_PM2_MONITOR_INTERVAL_MS`.

A restart initiated by `/maintenance update-bot` is marked as expected and does not trigger a false alarm. Manual PM2 restarts remain visible as a security notification.

The included production PM2 configuration has file watching disabled. Repository updates already perform an explicit controlled restart, which allows planned and unexpected restarts to be distinguished reliably.

The monitor remains active across main-bot crashes, syntax failures, hard kills, and out-of-memory restarts. It cannot send a message while the entire host, PM2 daemon, network connection, or Discord API is unavailable. Use an external uptime monitor when alerts are also required while the complete host is offline.

## Diagnostics

`/diagnostics` is available only to `DISCORD_OWNER_USER_ID` and performs read-only checks for:

- Discord guild, dashboard channel, and audit channel access
- Palworld REST API and server state
- Local or remote LinuxGSM script and working directory access
- Git repository availability
- Configured PM2 process availability

The response is ephemeral. Running diagnostics and any diagnostic failure are also recorded in the audit log.

## Requirements

- A Linux host
- [Node.js](https://nodejs.org/) 18 or newer
- A Palworld dedicated server managed by [LinuxGSM](https://linuxgsm.com/)
- The Palworld REST API enabled and reachable from the bot host
- Local mode: permission for the bot process to execute `/usr/sbin/runuser`, or run directly as the LinuxGSM user
- Remote mode: an OpenSSH client and key-based access to the Palworld host
- A Discord application with a bot user
- Git, npm, and PM2 available in the bot process `PATH` for owner maintenance
- Outbound HTTPS access to GitHub for the LinuxGSM release check

The Discord bot and Palworld server may run on the same host or on separate hosts. LinuxGSM commands use a configurable local/SSH executor, while the REST API uses its independently configured URL.

## Discord bot setup

Discord provides an official step-by-step guide for creating an application, obtaining a bot token, configuring installation, and inviting the bot:

[Building your first Discord bot — Step 1: Creating an app](https://docs.discord.com/developers/quick-start/getting-started#step-1-creating-an-app)

For this project:

1. Create a Discord application and bot user.
2. Copy the bot token into `DISCORD_BOT_TOKEN` in your local `.env` file.
3. Configure a Guild Install with the `bot` and `applications.commands` scopes.
4. Grant the bot these channel permissions:
   - View Channel
   - Send Messages
   - Embed Links
   - Read Message History
5. Invite the bot to your Discord server.
6. Enable Developer Mode in Discord and copy the server, channel, and authorized user IDs.

The bot only uses the standard `Guilds` Gateway intent. It does not require privileged Message Content or Guild Members intents.

> [!IMPORTANT]
> Never commit or share your Discord bot token. Discord describes bot tokens as highly sensitive credentials. If a token is exposed, reset it immediately in the Discord Developer Portal.

## Palworld REST API setup

Enable the REST API in your Palworld server configuration:

```ini
RESTAPIEnabled=True
RESTAPIPort=8212
```

Set the matching API URL and Basic Authentication credentials in `.env`. The default local endpoint is:

```text
http://127.0.0.1:8212/v1/api
```

See the official documentation for additional details:

- [Palworld server configuration](https://docs.palworldgame.com/settings-and-operation/configuration/)
- [Palworld REST API](https://docs.palworldgame.com/category/rest-api/)
- [Announcement endpoint](https://docs.palworldgame.com/api/rest-api/announce/)

> [!WARNING]
> The Palworld REST API provides administrative server operations. Keep it bound to localhost or a trusted private network. Do not expose it directly to the public Internet.

## Local and remote server execution

`PALWORLD_EXECUTION_MODE` controls where LinuxGSM commands run. The command executor is used for start, stop, update checks, update installation, reading the installed LinuxGSM version, and LinuxGSM diagnostics. Bot maintenance such as Git pulls and restarting the bot's PM2 process always runs on the bot host.

### Local mode

Use local mode when the bot and Palworld are installed on the same host:

```env
PALWORLD_EXECUTION_MODE=local

LINUXGSM_USER=pwserver
LINUXGSM_USE_RUNUSER=true
LINUXGSM_SCRIPT=/home/pwserver/pwserver
LINUXGSM_CWD=/home/pwserver

PALWORLD_API_URL=http://127.0.0.1:8212/v1/api
```

With `LINUXGSM_USE_RUNUSER=true`, commands are executed through `/usr/sbin/runuser -u LINUXGSM_USER`. Set it to `false` when the bot process already runs as the LinuxGSM user.

### Remote mode

Use remote mode when the bot and Palworld run on separate hosts. The recommended setup connects directly as the LinuxGSM user and therefore does not require remote root access:

```env
PALWORLD_EXECUTION_MODE=remote
PALWORLD_SSH_HOST=192.168.1.50
PALWORLD_SSH_PORT=22
PALWORLD_SSH_USER=pwserver
PALWORLD_SSH_IDENTITY_FILE=/home/discordbot/.ssh/palworld_bot
PALWORLD_SSH_KNOWN_HOSTS_FILE=/home/discordbot/.ssh/known_hosts
PALWORLD_SSH_CONNECT_TIMEOUT_MS=10000

LINUXGSM_USER=pwserver
LINUXGSM_USE_RUNUSER=false
LINUXGSM_SCRIPT=/home/pwserver/pwserver
LINUXGSM_CWD=/home/pwserver

PALWORLD_API_URL=http://192.168.1.50:8212/v1/api
```

The SSH identity and known-hosts paths are local paths on the bot host. The LinuxGSM script and working directory are paths on the Palworld host. `PALWORLD_SSH_IDENTITY_FILE` is optional when an SSH agent or the standard OpenSSH identity files are used. `PALWORLD_SSH_KNOWN_HOSTS_FILE` is optional and otherwise uses the OpenSSH default.

Before starting the bot, establish the SSH connection manually and verify the Palworld host fingerprint:

```bash
ssh -i /home/discordbot/.ssh/palworld_bot pwserver@192.168.1.50
```

The executor enforces batch mode and strict host-key checking, so it never waits for a password or an unknown-host confirmation. Do not disable host-key verification. Keep both SSH and the Palworld REST API on a private network, VPN, WireGuard, or Tailscale connection.

## Installation

Clone the repository and install the locked dependency versions:

```bash
git clone https://github.com/Rahman-Machaka/discord.git
cd discord
npm ci
```

Create your local configuration:

```bash
cp .env.example .env
```

Edit `.env` and fill in all required values.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_LOCALE` | No | Interface language: `en` or `de`; defaults to `en` if unavailable |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token from the Developer Portal |
| `DISCORD_GUILD_ID` | Yes | Discord server ID in which controls are accepted |
| `DISCORD_ALLOWED_USER_IDS` | Yes | Comma-separated Discord user IDs allowed to use controls |
| `DISCORD_OWNER_USER_ID` | Yes | The only Discord user allowed to execute maintenance actions |
| `PALWORLD_AUDIT_LOG_CHANNEL_ID` | No | Shared audit and update notification channel; defaults to `1270734893013405746` |
| `PALWORLD_STATUS_CHANNEL_ID` | Yes | Channel containing the persistent status message |
| `PALWORLD_API_URL` | Yes | Palworld REST API base URL without a trailing slash |
| `PALWORLD_API_USERNAME` | Yes | REST API Basic Authentication username |
| `PALWORLD_API_PASSWORD` | Yes | REST API Basic Authentication password |
| `PALWORLD_UPDATE_INTERVAL_MS` | No | Automatic status refresh interval; defaults to `60000` milliseconds |
| `PALWORLD_EXECUTION_MODE` | No | LinuxGSM execution mode: `local` or `remote`; defaults to `local` |
| `PALWORLD_SSH_BINARY` | No | Local OpenSSH executable; defaults to `ssh` |
| `PALWORLD_SSH_HOST` | Remote only | Hostname, private IP, or SSH config alias of the Palworld host |
| `PALWORLD_SSH_PORT` | No | SSH port; defaults to `22` |
| `PALWORLD_SSH_USER` | Remote only | SSH user on the Palworld host |
| `PALWORLD_SSH_IDENTITY_FILE` | No | Private key path on the bot host; OpenSSH defaults are used when omitted |
| `PALWORLD_SSH_KNOWN_HOSTS_FILE` | No | Known-hosts path on the bot host; OpenSSH defaults are used when omitted |
| `PALWORLD_SSH_CONNECT_TIMEOUT_MS` | No | SSH connection timeout; defaults to `10000` milliseconds |
| `LINUXGSM_USER` | No | Linux user running the Palworld server; defaults to `pwserver` |
| `LINUXGSM_USE_RUNUSER` | No | Execute through `/usr/sbin/runuser`; defaults to `true` locally and `false` remotely |
| `LINUXGSM_SCRIPT` | No | Absolute LinuxGSM script path on the selected local or remote host |
| `LINUXGSM_CWD` | No | LinuxGSM working directory on the selected local or remote host |
| `PM2_PROCESS_NAME` | No | PM2 process restarted after a bot update; defaults to `command-bot` |
| `PALWORLD_AUTO_UPDATE_CHECK_INTERVAL_MS` | No | Automatic update check interval; defaults to `3600000` milliseconds |
| `PALWORLD_RUNTIME_ALERT_COOLDOWN_MS` | No | Cooldown for identical non-fatal Discord alerts; defaults to `300000` milliseconds |
| `PALWORLD_PM2_MONITOR_INTERVAL_MS` | No | PM2 monitor polling interval; defaults to `15000` milliseconds |

Example allowlist:

```env
DISCORD_ALLOWED_USER_IDS=123456789012345678,234567890123456789
```

Do not add spaces unless they are part of a value. The `.env` file is ignored by Git; `.env.example` contains only safe example values.

## Feature flags

Individual controls can be enabled or disabled in `.env`. Every flag accepts only `true` or `false` and defaults to `true` when it is omitted.

| Variable | Controls |
| --- | --- |
| `FEATURE_SERVER_START_ENABLED` | Start server button and action |
| `FEATURE_SERVER_STOP_ENABLED` | Stop server button and action |
| `FEATURE_SERVER_SAVE_ENABLED` | Save server button and action |
| `FEATURE_SERVER_RESTART_ENABLED` | Restart server button and action |
| `FEATURE_MANUAL_REFRESH_ENABLED` | Manual refresh button and action |
| `FEATURE_ANNOUNCEMENTS_ENABLED` | Announcement menu option, modal, and action |
| `FEATURE_BOT_UPDATE_ENABLED` | Owner-only `/maintenance update-bot` command |
| `FEATURE_UPDATE_CHECK_ENABLED` | Owner-only update check in the dashboard action menu |
| `FEATURE_UPDATE_INSTALL_ENABLED` | Owner-only `/maintenance install-updates` command |
| `FEATURE_AUTO_STATUS_UPDATES_ENABLED` | Scheduled status refreshes |
| `FEATURE_AUDIT_LOG_ENABLED` | Audit entries and update notifications |
| `FEATURE_AUTO_UPDATE_CHECK_ENABLED` | Scheduled Palworld and LinuxGSM update checks |
| `FEATURE_DIAGNOSTICS_ENABLED` | Owner-only `/diagnostics` command |
| `FEATURE_RUNTIME_ERROR_ALERTS_ENABLED` | Owner pings for bot errors and unexpected PM2 restarts |

For example, this keeps status monitoring available while removing every server-changing and maintenance action:

```env
FEATURE_SERVER_START_ENABLED=false
FEATURE_SERVER_STOP_ENABLED=false
FEATURE_SERVER_SAVE_ENABLED=false
FEATURE_SERVER_RESTART_ENABLED=false
FEATURE_ANNOUNCEMENTS_ENABLED=false
FEATURE_BOT_UPDATE_ENABLED=false
FEATURE_UPDATE_INSTALL_ENABLED=false
```

Disabled controls and menu options are omitted from the Discord dashboard, and disabled maintenance subcommands are not registered. The bot also rejects interactions from older messages, stale command registrations, or already-open modals after a feature has been disabled. Disabling automatic status updates does not prevent the initial status message or manual refreshes. Restart the bot after changing feature flags.

## Languages and localization

English and German are included:

- `en` — English: `src/locales/en.js`
- `de` — German: `src/locales/de.js`

Select the language in `.env`:

```env
BOT_LOCALE=en
```

or:

```env
BOT_LOCALE=de
```

Restart the bot after changing the locale. If a requested locale file does not exist or the value is invalid, the bot falls back to English.

All user-facing messages, button labels, embed text, validation errors, and operational log messages are maintained in the locale files. Dynamic values use named placeholders:

```js
'status.onlineTitle': '🟢 {serverName}',
'interaction.actionFailed': '❌ Action failed: {message}'
```

When adding another locale, copy an existing locale file and preserve every key and placeholder name.

## Running the bot

Run directly with Node.js:

```bash
npm start
```

Run the syntax check:

```bash
npm run check
```

The bot creates `palworld-status-message.json` to remember which Discord message to update and `palworld-pm2-alert-state.json` to distinguish expected and unexpected restarts. Both runtime files are ignored by Git.

## Running with PM2

An example PM2 configuration is included in `commandbot.config.js`:

```bash
npm install --global pm2
pm2 start commandbot.config.js
pm2 save
pm2 logs command-bot
pm2 logs command-bot-monitor
```

The ecosystem starts two tasks: `command-bot` and the independent `command-bot-monitor`. Start or update the complete ecosystem rather than only the main task, otherwise permanent startup failures cannot be detected independently.

Before using it, review these environment-specific settings in `commandbot.config.js`:

- `out_file`
- `error_file`
- memory and restart limits

The current log paths point to `/root/discord/logs`. Create that directory with suitable permissions or replace the paths with locations appropriate for your host.

## Project structure

```text
src/
├── monitor.js                # Independent PM2 failure watcher
├── execution/
│   └── command-executor.js   # Local process and secure SSH execution
├── discord/
│   ├── interactions.js       # Buttons, modal, and ephemeral replies
│   ├── audit-log.js          # Shared Palworld audit and update notifications
│   ├── commands.js           # Guild slash command definitions
│   ├── status-message.js     # Persistent Discord status message
│   └── status-view.js        # Components V2 dashboard and contextual controls
├── locales/
│   ├── de.js                 # German messages
│   └── en.js                 # English messages
├── maintenance/
│   ├── automatic-update-checker.js
│   └── bot-maintenance.js    # Safe Git pull and delayed PM2 restart
├── monitoring/
│   ├── pm2-restart-monitor.js
│   └── runtime-alerts.js      # Direct Discord error notifications
├── palworld/
│   ├── api-client.js         # Palworld REST API client
│   └── server-controller.js  # Save/start/stop/restart coordination
├── storage/
│   └── status-message-store.js
├── config.js                 # Environment validation
├── diagnostics.js            # Read-only environment diagnostics
├── i18n.js                   # Locale loading and placeholder replacement
└── index.js                  # Application entry point
```

## Troubleshooting

### The bot exits during startup

Read the startup error and verify that every required variable in `.env` has a non-empty value.

### The status is unavailable

- Confirm that `RESTAPIEnabled=True` is configured.
- Confirm that the Palworld server is listening on `RESTAPIPort`.
- Check `PALWORLD_API_URL`, username, and password.
- Keep the API reachable locally instead of exposing it publicly.

### Buttons are visible but cannot be used

- Confirm that the user ID is included in `DISCORD_ALLOWED_USER_IDS`.
- Confirm that `DISCORD_GUILD_ID` matches the current Discord server.
- Start, stop, save, restart, and announcement controls require a safely determined server state.

### The `/maintenance` command is missing

- Restart the bot so it can register the guild command.
- Confirm that the bot was installed with the `applications.commands` scope.
- Check the bot log for a slash command registration error.
- Confirm that `FEATURE_BOT_UPDATE_ENABLED` or `FEATURE_UPDATE_INSTALL_ENABLED` is enabled.

### LinuxGSM commands fail

- Verify `LINUXGSM_USER`, `LINUXGSM_SCRIPT`, and `LINUXGSM_CWD`.
- In local mode, verify `LINUXGSM_USE_RUNUSER` and permission to use `/usr/sbin/runuser`.
- In remote mode, run the configured SSH command manually as the bot operating-system user.
- Verify the SSH private-key permissions and the Palworld host entry in `known_hosts`.
- Confirm that `LINUXGSM_USE_RUNUSER=false` when SSH connects directly as the LinuxGSM user.
- Review the PM2 error log for command output.

### Owner maintenance fails

- Confirm that `DISCORD_OWNER_USER_ID` contains your Discord user ID.
- Confirm that `PM2_PROCESS_NAME` matches `pm2 list`.
- Confirm that `git`, `npm`, and `pm2` are available to the bot process.
- Commit, stash, or revert tracked local repository changes before using `/maintenance update-bot`.
- Confirm that the host can reach GitHub for Git pulls and LinuxGSM release checks.

### Audit entries or update notifications are missing

- Confirm that `PALWORLD_AUDIT_LOG_CHANNEL_ID` is correct.
- Grant the bot **View Channel**, **Send Messages**, and **Embed Links** in the audit channel.
- Confirm that `FEATURE_AUDIT_LOG_ENABLED=true`.
- For scheduled checks, also confirm that `FEATURE_AUTO_UPDATE_CHECK_ENABLED=true`.
- Review the PM2 error log for audit or automatic update check errors.

### Runtime or PM2 error alerts are missing

- Confirm that `FEATURE_RUNTIME_ERROR_ALERTS_ENABLED=true`.
- Confirm that `DISCORD_OWNER_USER_ID` and `PALWORLD_AUDIT_LOG_CHANNEL_ID` are correct.
- Grant the bot **View Channel**, **Send Messages**, and **Embed Links** in the audit channel.
- Run `pm2 jlist` as the same operating-system user that runs the bot.
- Confirm that both `command-bot` and `command-bot-monitor` appear in `pm2 list`.
- Confirm that the bot host can reach `https://discord.com`.
- Remember that a completely offline host requires an external uptime monitor.

### `/diagnostics` is missing

- Restart the bot so guild commands are registered again.
- Confirm that `FEATURE_DIAGNOSTICS_ENABLED=true`.
- Confirm that the bot was installed with the `applications.commands` scope.

## Support

I am happy to provide support on Discord for questions, bugs, or problems that are directly related to the code in this repository.

Due to the time and effort required, I unfortunately cannot provide individual support for general topics that are already covered by documentation and other resources on the Internet. This includes, for example, setting up a Discord bot, administering Linux, configuring Node.js or PM2, installing LinuxGSM, and configuring a Palworld dedicated server or its REST API.

Before requesting support, please consult the linked official documentation and the troubleshooting section above. For code-related support, please include a clear description of the problem, relevant error messages with secrets removed, and the Node.js version you are using.

Discord: @mister__rahman / 208127289802752002

## Security

- Never commit `.env`.
- Rotate Discord and Palworld credentials if they are exposed.
- Only allow trusted Discord user IDs to control the server.
- Keep the Palworld REST API on localhost or a trusted private network.
- Review Linux user permissions before running the bot as `root`.
- Treat `DISCORD_OWNER_USER_ID` as a privileged operator identity.
- Protect the Git remote and branch used by the server; owner updates execute newly pulled code.
- Review dependency advisories regularly with `npm audit`.
