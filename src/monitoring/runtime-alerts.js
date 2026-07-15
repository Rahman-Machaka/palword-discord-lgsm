const { t } = require('../i18n.js');

const discordApiBaseUrl = 'https://discord.com/api/v10';

function truncate(value, maxLength = 1_024) {
    const text = String(value || '').trim();

    return text.length > maxLength
        ? `${text.slice(0, maxLength - 1)}…`
        : text;
}

function errorText(error, token) {
    const text = error?.stack || error?.message || error ||
        t('diagnostics.unknownError');
    const sanitized = token
        ? String(text).replaceAll(token, '[REDACTED]')
        : String(text);

    return truncate(sanitized);
}

function createRuntimeAlertService(initialConfig = {}, dependencies = {}) {
    const sendRequest = dependencies.fetch || fetch;
    let config = { ...initialConfig };
    let processHandlersInstalled = false;
    let fatalErrorInProgress = false;
    const lastNotifications = new Map();

    function configure(nextConfig) {
        config = { ...config, ...nextConfig };
    }

    async function notify({
        source,
        error = null,
        details = null,
        fatal = false,
        bypassCooldown = false
    }) {
        if (!config.enabled) {
            return { sent: false, reason: 'disabled' };
        }

        if (!config.token || !config.channelId || !config.ownerUserId) {
            return { sent: false, reason: 'configuration' };
        }

        const renderedError = error ? errorText(error, config.token) : null;
        const signatureError = error?.message || error || '';
        const signature = `${source}:${signatureError || details || ''}`;
        const now = Date.now();
        const lastNotification = lastNotifications.get(signature) || 0;

        if (
            !bypassCooldown &&
            now - lastNotification < config.cooldownMs
        ) {
            return { sent: false, reason: 'cooldown' };
        }

        const fields = [
            {
                name: t('alert.source'),
                value: t(`alert.source.${source}`),
                inline: true
            },
            {
                name: t('alert.severity'),
                value: fatal
                    ? t('alert.severityFatal')
                    : t('alert.severityError'),
                inline: true
            }
        ];

        if (details) {
            fields.push({
                name: t('alert.details'),
                value: truncate(details)
            });
        }

        if (renderedError) {
            fields.push({
                name: t('alert.error'),
                value: renderedError
            });
        }

        try {
            const response = await sendRequest(
                `${discordApiBaseUrl}/channels/${config.channelId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bot ${config.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        content: `<@${config.ownerUserId}>`,
                        allowed_mentions: {
                            parse: [],
                            users: [config.ownerUserId]
                        },
                        embeds: [{
                            title: t('alert.title'),
                            color: fatal ? 0x992d22 : 0xe74c3c,
                            fields,
                            timestamp: new Date().toISOString()
                        }]
                    }),
                    signal: AbortSignal.timeout(5_000)
                }
            );

            if (!response.ok) {
                throw new Error(t('alert.httpError', {
                    status: response.status
                }));
            }

            lastNotifications.set(signature, now);
            return { sent: true };
        } catch (notificationError) {
            console.error(
                t('log.runtimeAlertFailed'),
                notificationError.message
            );
            return {
                sent: false,
                reason: 'error',
                error: notificationError
            };
        }
    }

    function handleFatal(source, error) {
        if (fatalErrorInProgress) {
            process.exit(1);
            return;
        }

        fatalErrorInProgress = true;
        console.error(t('log.fatalRuntimeError', {
            source: t(`alert.source.${source}`)
        }), error);

        notify({
            source,
            error,
            fatal: true,
            bypassCooldown: true
        }).finally(() => {
            process.exit(1);
        });

        setTimeout(() => process.exit(1), 6_000).unref();
    }

    function installProcessHandlers() {
        if (processHandlersInstalled) {
            return;
        }

        processHandlersInstalled = true;
        process.on('uncaughtException', error => {
            handleFatal('uncaughtException', error);
        });
        process.on('unhandledRejection', reason => {
            handleFatal('unhandledRejection', reason);
        });
    }

    return {
        configure,
        installProcessHandlers,
        notify
    };
}

module.exports = {
    createRuntimeAlertService,
    errorText
};
