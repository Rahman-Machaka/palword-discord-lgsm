const { MessageFlags } = require('discord.js');
const { createStatusDashboard } = require('./status-view.js');
const { t } = require('../i18n.js');

function createStatusMessageService({
    client,
    channelId,
    apiClient,
    messageStore,
    isActionRunning,
    features = {}
}) {
    let updateRunning = false;

    async function update() {
        if (updateRunning) {
            return { updated: false, reason: 'busy' };
        }

        updateRunning = true;

        try {
            const channel = await client.channels.fetch(channelId);

            if (!channel || !channel.isTextBased()) {
                throw new Error(t('statusMessage.invalidChannel', {
                    channelId
                }));
            }

            const status = await apiClient.getStatus();
            const payload = {
                allowedMentions: { parse: [] },
                components: [createStatusDashboard(
                    status,
                    isActionRunning(),
                    features
                )],
                flags: MessageFlags.IsComponentsV2
            };
            const savedMessageId = await messageStore.read();
            let statusMessage = null;

            if (savedMessageId) {
                try {
                    statusMessage = await channel.messages.fetch(savedMessageId);
                } catch (error) {
                    if (error.code !== 10008) {
                        console.warn(
                            t('log.savedStatusMessageMissing'),
                            error.message
                        );
                    }
                }
            }

            if (
                statusMessage &&
                statusMessage.flags.has(MessageFlags.IsComponentsV2)
            ) {
                await statusMessage.edit(payload);
            } else {
                const previousMessage = statusMessage;
                const newMessage = await channel.send(payload);

                await messageStore.save(newMessage.id);
                statusMessage = newMessage;

                if (previousMessage) {
                    await previousMessage.delete().catch(error => {
                        console.warn(
                            t('log.legacyStatusMessageDeleteFailed'),
                            error.message
                        );
                    });
                }
            }

            return { updated: true, status };
        } finally {
            updateRunning = false;
        }
    }

    return { update };
}

module.exports = {
    createStatusMessageService
};
