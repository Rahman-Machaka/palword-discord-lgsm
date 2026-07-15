const path = require('node:path');
const {
    Client,
    Events,
    GatewayIntentBits
} = require('discord.js');
const { t } = require('./i18n.js');
const { loadConfig } = require('./config.js');
const { createDiagnosticsService } = require('./diagnostics.js');
const {
    createCommandExecutor
} = require('./execution/command-executor.js');
const { createAuditLogger } = require('./discord/audit-log.js');
const { createGuildCommands } = require('./discord/commands.js');
const { createInteractionHandler } = require('./discord/interactions.js');
const {
    createStatusMessageService
} = require('./discord/status-message.js');
const {
    createBotMaintenance
} = require('./maintenance/bot-maintenance.js');
const {
    createAutomaticUpdateChecker
} = require('./maintenance/automatic-update-checker.js');
const {
    createPm2RestartMonitor
} = require('./monitoring/pm2-restart-monitor.js');
const {
    createRuntimeAlertService
} = require('./monitoring/runtime-alerts.js');
const {
    createPalworldApiClient
} = require('./palworld/api-client.js');
const {
    createServerController
} = require('./palworld/server-controller.js');
const {
    createStatusMessageStore
} = require('./storage/status-message-store.js');

const bootstrapCooldown = Number(
    process.env.PALWORLD_RUNTIME_ALERT_COOLDOWN_MS
);
const runtimeAlerts = createRuntimeAlertService({
    channelId: process.env.PALWORLD_AUDIT_LOG_CHANNEL_ID ||
        '1270734893013405746',
    cooldownMs: Number.isSafeInteger(bootstrapCooldown) &&
        bootstrapCooldown > 0
        ? bootstrapCooldown
        : 300_000,
    enabled: process.env.FEATURE_RUNTIME_ERROR_ALERTS_ENABLED
        ?.trim()
        .toLowerCase() !== 'false',
    ownerUserId: process.env.DISCORD_OWNER_USER_ID,
    token: process.env.DISCORD_BOT_TOKEN
});

runtimeAlerts.installProcessHandlers();

async function main() {
    const config = loadConfig();
    runtimeAlerts.configure({
        channelId: config.discord.auditLogChannelId,
        cooldownMs: config.alerts.cooldownMs,
        enabled: config.features.runtimeAlerts,
        ownerUserId: config.discord.ownerUserId,
        token: config.discord.token
    });
    const client = new Client({
        intents: [GatewayIntentBits.Guilds]
    });
    const reportBackgroundError = (source, error) => {
        runtimeAlerts.notify({ source, error }).catch(notificationError => {
            console.error(t('log.runtimeAlertFailed'), notificationError);
        });
    };
    const apiClient = createPalworldApiClient(config.palworld.api);
    const serverCommandExecutor = createCommandExecutor(config.execution);
    const auditLogger = createAuditLogger({
        client,
        channelId: config.discord.auditLogChannelId,
        enabled: config.features.auditLog,
        onError: error => {
            reportBackgroundError('auditLog', error);
        }
    });
    const pm2RestartMonitor = createPm2RestartMonitor({
        processName: config.maintenance.pm2ProcessName,
        runtimeAlerts,
        stateFile: config.alerts.pm2StateFile
    });
    let botMaintenance = null;
    const serverController = createServerController({
        apiClient,
        linuxGsm: config.linuxGsm,
        commandExecutor: serverCommandExecutor,
        isExternalActionRunning: () =>
            botMaintenance?.isBusy() || false
    });
    botMaintenance = createBotMaintenance({
        ecosystemFile: config.maintenance.ecosystemFile,
        repositoryCwd: config.maintenance.repositoryCwd,
        pm2ProcessName: config.maintenance.pm2ProcessName,
        beforePm2Restart: pm2RestartMonitor.expectRestart,
        onBackgroundError: error => {
            reportBackgroundError('pm2Monitor', error);
        },
        isExternalActionRunning: serverController.isBusy
    });
    const messageStore = createStatusMessageStore(
        path.resolve(__dirname, '..', 'palworld-status-message.json')
    );
    const statusMessageService = createStatusMessageService({
        client,
        channelId: config.palworld.statusChannelId,
        apiClient,
        messageStore,
        isActionRunning: () =>
            serverController.isBusy() || botMaintenance.isBusy(),
        features: config.features
    });
    const diagnosticsService = createDiagnosticsService({
        client,
        guildId: config.discord.guildId,
        statusChannelId: config.palworld.statusChannelId,
        auditChannelId: config.discord.auditLogChannelId,
        apiClient,
        linuxGsm: config.linuxGsm,
        repositoryCwd: config.maintenance.repositoryCwd,
        pm2ProcessName: config.maintenance.pm2ProcessName,
        serverCommandExecutor
    });
    const automaticUpdateChecker = createAutomaticUpdateChecker({
        serverController,
        auditLogger,
        ownerUserId: config.discord.ownerUserId,
        onError: error => {
            reportBackgroundError('automaticUpdateCheck', error);
        }
    });
    const handleInteraction = createInteractionHandler({
        guildId: config.discord.guildId,
        allowedUserIds: config.discord.allowedUserIds,
        ownerUserId: config.discord.ownerUserId,
        auditLogger,
        botMaintenance,
        diagnosticsService,
        serverController,
        statusMessageService,
        features: config.features
    });
    let statusInterval = null;
    let updateCheckInterval = null;

    client.on(Events.InteractionCreate, handleInteraction);
    client.on(Events.Error, error => {
        console.error(t('log.discordClientError'), error);
        reportBackgroundError('discordClient', error);
    });
    client.once(Events.ClientReady, async readyClient => {
        console.log(t('log.ready', { tag: readyClient.user.tag }));

        await readyClient.guilds.fetch(config.discord.guildId)
            .then(guild => guild.commands.set(
                createGuildCommands(config.features)
            ))
            .catch(error => {
                console.error(t('log.commandRegistrationFailed'), error);
                reportBackgroundError('commandRegistration', error);
            });

        await statusMessageService.update().catch(error => {
            console.error(t('log.initialStatusUpdateFailed'), error);
            reportBackgroundError('initialStatusUpdate', error);
        });

        if (config.features.autoStatusUpdates) {
            statusInterval = setInterval(() => {
                statusMessageService.update().catch(error => {
                    console.error(t('log.statusUpdateFailed'), error);
                    reportBackgroundError('statusUpdate', error);
                });
            }, config.palworld.updateIntervalMs);
        }

        if (
            config.features.autoUpdateCheck &&
            config.features.auditLog
        ) {
            automaticUpdateChecker.check().catch(error => {
                console.error(t('log.automaticUpdateCheckFailed'), error);
                reportBackgroundError('automaticUpdateCheck', error);
            });
            updateCheckInterval = setInterval(() => {
                automaticUpdateChecker.check().catch(error => {
                    console.error(t('log.automaticUpdateCheckFailed'), error);
                    reportBackgroundError('automaticUpdateCheck', error);
                });
            }, config.maintenance.updateCheckIntervalMs);
        }
    });

    function shutdown(signal) {
        console.log(t('log.shutdown', { signal }));

        if (statusInterval) {
            clearInterval(statusInterval);
        }

        if (updateCheckInterval) {
            clearInterval(updateCheckInterval);
        }

        client.destroy();
    }

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    await client.login(config.discord.token);
}

main().catch(async error => {
    console.error(t('log.startFailed'), error.message);
    await runtimeAlerts.notify({
        source: 'startup',
        error,
        fatal: true,
        bypassCooldown: true
    });
    process.exitCode = 1;
});
