const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { t } = require('./i18n.js');
const {
    createLocalExecutor
} = require('./execution/command-executor.js');

const execFileAsync = promisify(execFile);

function cleanError(error) {
    return String(error?.message || error || t('diagnostics.unknownError'))
        .split(/\r?\n/, 1)[0]
        .slice(0, 300);
}

function createDiagnosticsService({
    client,
    guildId,
    statusChannelId,
    auditChannelId,
    apiClient,
    linuxGsm,
    repositoryCwd,
    pm2ProcessName,
    execute = execFileAsync,
    serverCommandExecutor = createLocalExecutor()
}) {
    async function capture(name, task) {
        try {
            const result = await task();

            return { name, status: result.status || 'ok', detail: result.detail };
        } catch (error) {
            return {
                name,
                status: 'error',
                detail: cleanError(error)
            };
        }
    }

    async function checkDiscord() {
        const guild = await client.guilds.fetch(guildId);
        const [statusChannel, auditChannel] = await Promise.all([
            client.channels.fetch(statusChannelId),
            client.channels.fetch(auditChannelId)
        ]);

        if (!statusChannel?.isTextBased() || !auditChannel?.isTextBased()) {
            throw new Error(t('diagnostics.invalidDiscordChannels'));
        }

        return {
            detail: t('diagnostics.discordOk', { guild: guild.name })
        };
    }

    async function checkPalworldApi() {
        const status = await apiClient.getStatus();

        if (status.state === 'online') {
            return { detail: t('diagnostics.palworldOnline') };
        }

        if (status.state === 'offline') {
            return {
                status: 'warning',
                detail: t('diagnostics.palworldOffline')
            };
        }

        return {
            status: 'error',
            detail: status.error || t('diagnostics.palworldUnavailable')
        };
    }

    async function checkLinuxGsm() {
        await Promise.all([
            serverCommandExecutor.assertAccess(linuxGsm.script, {
                readable: true,
                executable: true
            }),
            serverCommandExecutor.assertAccess(linuxGsm.cwd, {
                readable: true,
                executable: true
            })
        ]);

        return {
            detail: t('diagnostics.linuxGsmOk', {
                mode: t(`execution.mode.${serverCommandExecutor.mode}`)
            })
        };
    }

    async function checkGit() {
        const { stdout } = await execute(
            'git',
            ['rev-parse', '--is-inside-work-tree'],
            {
                cwd: repositoryCwd,
                timeout: 30_000,
                windowsHide: true
            }
        );

        if (stdout.trim() !== 'true') {
            throw new Error(t('diagnostics.gitInvalid'));
        }

        return { detail: t('diagnostics.gitOk') };
    }

    async function checkPm2() {
        await execute('pm2', ['describe', pm2ProcessName], {
            cwd: repositoryCwd,
            timeout: 30_000,
            windowsHide: true
        });

        return {
            detail: t('diagnostics.pm2Ok', { process: pm2ProcessName })
        };
    }

    async function run() {
        return Promise.all([
            capture(t('diagnostics.check.discord'), checkDiscord),
            capture(t('diagnostics.check.palworldApi'), checkPalworldApi),
            capture(t('diagnostics.check.linuxGsm', {
                mode: t(`execution.mode.${serverCommandExecutor.mode}`)
            }), checkLinuxGsm),
            capture(t('diagnostics.check.git'), checkGit),
            capture(t('diagnostics.check.pm2'), checkPm2)
        ]);
    }

    return { run };
}

module.exports = {
    createDiagnosticsService
};
