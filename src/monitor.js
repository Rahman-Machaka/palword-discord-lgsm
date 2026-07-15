const path = require('node:path');
const dotenv = require('dotenv');
const { setLocale, t } = require('./i18n.js');
const {
    createPm2RestartMonitor
} = require('./monitoring/pm2-restart-monitor.js');
const {
    createRuntimeAlertService
} = require('./monitoring/runtime-alerts.js');

dotenv.config({
    path: path.resolve(__dirname, '..', '.env'),
    quiet: true
});

setLocale(process.env.BOT_LOCALE || 'en');

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

const processName = process.env.PM2_PROCESS_NAME || 'command-bot';
const alertCooldownMs = positiveInteger(
    process.env.PALWORLD_RUNTIME_ALERT_COOLDOWN_MS,
    300_000
);
const monitorIntervalMs = positiveInteger(
    process.env.PALWORLD_PM2_MONITOR_INTERVAL_MS,
    15_000
);
const runtimeAlerts = createRuntimeAlertService({
    channelId: process.env.PALWORLD_AUDIT_LOG_CHANNEL_ID ||
        '1270734893013405746',
    cooldownMs: alertCooldownMs,
    enabled: process.env.FEATURE_RUNTIME_ERROR_ALERTS_ENABLED
        ?.trim()
        .toLowerCase() !== 'false',
    ownerUserId: process.env.DISCORD_OWNER_USER_ID,
    token: process.env.DISCORD_BOT_TOKEN
});
const pm2Monitor = createPm2RestartMonitor({
    processName,
    runtimeAlerts,
    stateFile: path.resolve(
        __dirname,
        '..',
        'palworld-pm2-alert-state.json'
    )
});
const unhealthyStatuses = new Set(['errored', 'stopped']);
let checkRunning = false;

runtimeAlerts.installProcessHandlers();

async function checkPm2() {
    if (checkRunning) {
        return;
    }

    checkRunning = true;

    try {
        const result = await pm2Monitor.check();

        if (unhealthyStatuses.has(result.processInfo.status)) {
            await runtimeAlerts.notify({
                source: 'pm2Status',
                fatal: true,
                details: t('alert.pm2StatusDetails', {
                    process: processName,
                    status: result.processInfo.status
                })
            });
        }
    } catch (error) {
        console.error(t('log.pm2MonitorFailed'), error);
        await runtimeAlerts.notify({
            source: 'pm2Monitor',
            error,
            fatal: true
        });
    } finally {
        checkRunning = false;
    }
}

const initialCheck = setTimeout(checkPm2, 5_000);
const monitorInterval = setInterval(checkPm2, monitorIntervalMs);

function shutdown(signal) {
    console.log(t('log.monitorShutdown', { signal }));
    clearTimeout(initialCheck);
    clearInterval(monitorInterval);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
