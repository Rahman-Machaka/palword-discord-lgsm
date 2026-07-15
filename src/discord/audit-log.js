const { EmbedBuilder } = require('discord.js');
const { t } = require('../i18n.js');

const outcomeColors = {
    success: 0x2ecc71,
    failed: 0xe74c3c,
    denied: 0xf39c12,
    cancelled: 0x95a5a6,
    info: 0x3498db
};

function truncate(value, maxLength = 1_024) {
    const text = String(value || '').trim();

    return text.length > maxLength
        ? `${text.slice(0, maxLength - 1)}…`
        : text;
}

function createAuditLogger({
    client,
    channelId,
    enabled = true,
    onError = () => {}
}) {
    let channel = null;

    async function getChannel() {
        if (!channel) {
            channel = await client.channels.fetch(channelId);

            if (!channel || !channel.isTextBased()) {
                throw new Error(t('audit.invalidChannel', { channelId }));
            }
        }

        return channel;
    }

    async function send({
        action,
        outcome = 'info',
        user = null,
        details = null,
        error = null,
        content = null,
        allowedMentions = { parse: [] }
    }) {
        if (!enabled) {
            return { sent: false, reason: 'disabled' };
        }

        try {
            const targetChannel = await getChannel();
            const embed = new EmbedBuilder()
                .setTitle(t('audit.title', {
                    action: t(`audit.action.${action}`)
                }))
                .setColor(outcomeColors[outcome] || outcomeColors.info)
                .addFields({
                    name: t('audit.result'),
                    value: t(`audit.outcome.${outcome}`),
                    inline: true
                })
                .setTimestamp();

            if (user?.id) {
                embed.addFields({
                    name: t('audit.executedBy'),
                    value: t('audit.userValue', {
                        mention: `<@${user.id}>`,
                        id: user.id
                    }),
                    inline: true
                });
            }

            if (details) {
                embed.addFields({
                    name: t('audit.details'),
                    value: truncate(details)
                });
            }

            if (error) {
                embed.addFields({
                    name: t('audit.error'),
                    value: truncate(error.message || error)
                });
            }

            await targetChannel.send({
                content: content || undefined,
                embeds: [embed],
                allowedMentions
            });

            return { sent: true };
        } catch (auditError) {
            console.error(t('log.auditLogFailed'), auditError);
            await Promise.resolve(onError(auditError)).catch(() => {});
            return { sent: false, reason: 'error', error: auditError };
        }
    }

    async function notifyUpdateAvailable({ ownerUserId, result }) {
        const palworldStatus = result.palworldUpdateAvailable
            ? t('maintenance.updateAvailable')
            : t('maintenance.upToDate');
        const linuxGsmStatus = result.linuxGsm.error
            ? t('maintenance.statusUnavailable', {
                message: result.linuxGsm.error
            })
            : t('audit.linuxGsmUpdateStatus', {
                installed: result.linuxGsm.installedVersion,
                latest: result.linuxGsm.latestVersion,
                status: result.linuxGsm.updateAvailable
                    ? t('maintenance.updateAvailable')
                    : t('maintenance.upToDate')
            });

        return send({
            action: 'updateAvailable',
            outcome: 'info',
            content: `<@${ownerUserId}>`,
            allowedMentions: {
                parse: [],
                users: [ownerUserId]
            },
            details: t('audit.updateDetails', {
                palworld: palworldStatus,
                linuxGsm: linuxGsmStatus
            })
        });
    }

    return {
        log: send,
        notifyUpdateAvailable
    };
}

module.exports = {
    createAuditLogger
};
