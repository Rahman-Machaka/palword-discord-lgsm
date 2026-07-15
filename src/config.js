const path = require('node:path');
const dotenv = require('dotenv');
const { setLocale, t } = require('./i18n.js');

dotenv.config({
    path: path.resolve(__dirname, '..', '.env'),
    quiet: true
});

function requireValue(environment, name) {
    const value = environment[name]?.trim();

    if (!value) {
        throw new Error(t('config.required', { name }));
    }

    return value;
}

function optionalValue(environment, name, fallback) {
    return environment[name]?.trim() || fallback;
}

function positiveInteger(environment, name, fallback) {
    const rawValue = optionalValue(environment, name, String(fallback));
    const value = Number(rawValue);

    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(t('config.positiveInteger', { name }));
    }

    return value;
}

function integerInRange(environment, name, fallback, minimum, maximum) {
    const value = positiveInteger(environment, name, fallback);

    if (value < minimum || value > maximum) {
        throw new Error(t('config.integerRange', {
            name,
            minimum,
            maximum
        }));
    }

    return value;
}

function choiceValue(environment, name, fallback, choices) {
    const value = optionalValue(environment, name, fallback).toLowerCase();

    if (!choices.includes(value)) {
        throw new Error(t('config.choice', {
            name,
            choices: choices.join(', ')
        }));
    }

    return value;
}

function booleanValue(environment, name, fallback = true) {
    const rawValue = optionalValue(
        environment,
        name,
        String(fallback)
    ).toLowerCase();

    if (!['true', 'false'].includes(rawValue)) {
        throw new Error(t('config.boolean', { name }));
    }

    return rawValue === 'true';
}

function commaSeparatedValues(environment, name) {
    const values = requireValue(environment, name)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

    if (values.length === 0) {
        throw new Error(t('config.nonEmptyList', { name }));
    }

    return values;
}

function loadConfig(environment = process.env) {
    const locale = setLocale(
        optionalValue(environment, 'BOT_LOCALE', 'en')
    );
    const executionMode = choiceValue(
        environment,
        'PALWORLD_EXECUTION_MODE',
        'local',
        ['local', 'remote']
    );
    const sshHost = executionMode === 'remote'
        ? requireValue(environment, 'PALWORLD_SSH_HOST')
        : null;
    const sshUser = executionMode === 'remote'
        ? requireValue(environment, 'PALWORLD_SSH_USER')
        : null;

    if (sshHost && (/\s/.test(sshHost) || sshHost.startsWith('-'))) {
        throw new Error(t('config.sshHost'));
    }

    if (sshUser && !/^[a-zA-Z0-9._-]+$/.test(sshUser)) {
        throw new Error(t('config.sshUser'));
    }

    return {
        locale,
        execution: {
            mode: executionMode,
            ssh: {
                binary: optionalValue(
                    environment,
                    'PALWORLD_SSH_BINARY',
                    'ssh'
                ),
                host: sshHost,
                port: integerInRange(
                    environment,
                    'PALWORLD_SSH_PORT',
                    22,
                    1,
                    65_535
                ),
                user: sshUser,
                identityFile: optionalValue(
                    environment,
                    'PALWORLD_SSH_IDENTITY_FILE',
                    null
                ),
                knownHostsFile: optionalValue(
                    environment,
                    'PALWORLD_SSH_KNOWN_HOSTS_FILE',
                    null
                ),
                connectTimeoutMs: positiveInteger(
                    environment,
                    'PALWORLD_SSH_CONNECT_TIMEOUT_MS',
                    10_000
                )
            }
        },
        discord: {
            token: requireValue(environment, 'DISCORD_BOT_TOKEN'),
            guildId: requireValue(environment, 'DISCORD_GUILD_ID'),
            allowedUserIds: commaSeparatedValues(
                environment,
                'DISCORD_ALLOWED_USER_IDS'
            ),
            ownerUserId: requireValue(
                environment,
                'DISCORD_OWNER_USER_ID'
            ),
            auditLogChannelId: optionalValue(
                environment,
                'PALWORLD_AUDIT_LOG_CHANNEL_ID',
                '1270734893013405746'
            )
        },
        palworld: {
            statusChannelId: requireValue(
                environment,
                'PALWORLD_STATUS_CHANNEL_ID'
            ),
            api: {
                url: requireValue(environment, 'PALWORLD_API_URL').replace(/\/$/, ''),
                username: requireValue(environment, 'PALWORLD_API_USERNAME'),
                password: requireValue(environment, 'PALWORLD_API_PASSWORD')
            },
            updateIntervalMs: positiveInteger(
                environment,
                'PALWORLD_UPDATE_INTERVAL_MS',
                60_000
            )
        },
        linuxGsm: {
            user: optionalValue(environment, 'LINUXGSM_USER', 'pwserver'),
            useRunuser: booleanValue(
                environment,
                'LINUXGSM_USE_RUNUSER',
                executionMode === 'local'
            ),
            script: optionalValue(
                environment,
                'LINUXGSM_SCRIPT',
                '/home/pwserver/pwserver'
            ),
            cwd: optionalValue(
                environment,
                'LINUXGSM_CWD',
                '/home/pwserver'
            )
        },
        maintenance: {
            ecosystemFile: path.resolve(
                __dirname,
                '..',
                'commandbot.config.js'
            ),
            pm2ProcessName: optionalValue(
                environment,
                'PM2_PROCESS_NAME',
                'command-bot'
            ),
            updateCheckIntervalMs: positiveInteger(
                environment,
                'PALWORLD_AUTO_UPDATE_CHECK_INTERVAL_MS',
                3_600_000
            ),
            repositoryCwd: path.resolve(__dirname, '..')
        },
        alerts: {
            cooldownMs: positiveInteger(
                environment,
                'PALWORLD_RUNTIME_ALERT_COOLDOWN_MS',
                300_000
            ),
            pm2MonitorIntervalMs: positiveInteger(
                environment,
                'PALWORLD_PM2_MONITOR_INTERVAL_MS',
                15_000
            ),
            pm2StateFile: path.resolve(
                __dirname,
                '..',
                'palworld-pm2-alert-state.json'
            )
        },
        features: {
            start: booleanValue(
                environment,
                'FEATURE_SERVER_START_ENABLED'
            ),
            stop: booleanValue(
                environment,
                'FEATURE_SERVER_STOP_ENABLED'
            ),
            save: booleanValue(
                environment,
                'FEATURE_SERVER_SAVE_ENABLED'
            ),
            restart: booleanValue(
                environment,
                'FEATURE_SERVER_RESTART_ENABLED'
            ),
            refresh: booleanValue(
                environment,
                'FEATURE_MANUAL_REFRESH_ENABLED'
            ),
            announce: booleanValue(
                environment,
                'FEATURE_ANNOUNCEMENTS_ENABLED'
            ),
            botUpdate: booleanValue(
                environment,
                'FEATURE_BOT_UPDATE_ENABLED'
            ),
            checkUpdates: booleanValue(
                environment,
                'FEATURE_UPDATE_CHECK_ENABLED'
            ),
            applyUpdates: booleanValue(
                environment,
                'FEATURE_UPDATE_INSTALL_ENABLED'
            ),
            autoStatusUpdates: booleanValue(
                environment,
                'FEATURE_AUTO_STATUS_UPDATES_ENABLED'
            ),
            auditLog: booleanValue(
                environment,
                'FEATURE_AUDIT_LOG_ENABLED'
            ),
            autoUpdateCheck: booleanValue(
                environment,
                'FEATURE_AUTO_UPDATE_CHECK_ENABLED'
            ),
            diagnostics: booleanValue(
                environment,
                'FEATURE_DIAGNOSTICS_ENABLED'
            ),
            runtimeAlerts: booleanValue(
                environment,
                'FEATURE_RUNTIME_ERROR_ALERTS_ENABLED'
            )
        }
    };
}

module.exports = {
    loadConfig
};
