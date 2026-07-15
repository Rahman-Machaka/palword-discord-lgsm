const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { t } = require('../i18n.js');
const {
    diagnosticsCommandName,
    featureBySubcommand,
    maintenanceCommandName,
    maintenanceSubcommands
} = require('./commands.js');
const { MaintenanceBusyError } = require('../maintenance/bot-maintenance.js');
const { ServerActionBusyError } = require('../palworld/server-controller.js');

const announcementButtonId = 'palworld_announce';
const announcementModalId = 'palworld_announce_modal';
const announcementInputId = 'palworld_announce_message';
const moreActionsId = 'palworld_more_actions';
const announceAction = 'announce';
const checkUpdatesAction = 'check_updates';
const maintenanceUpdateBotId = 'maintenance_update_bot';
const maintenanceUpdateBotConfirmId = 'maintenance_update_bot_confirm';
const maintenanceCheckUpdatesId = 'maintenance_check_updates';
const maintenanceApplyUpdatesId = 'maintenance_apply_updates';
const maintenanceApplyUpdatesConfirmId = 'maintenance_apply_updates_confirm';
const maintenanceCancelId = 'maintenance_cancel';
const legacyMaintenanceButtonIds = new Set([
    maintenanceUpdateBotId,
    maintenanceCheckUpdatesId,
    maintenanceApplyUpdatesId
]);
const maintenanceConfirmationIds = new Set([
    maintenanceUpdateBotConfirmId,
    maintenanceApplyUpdatesConfirmId,
    maintenanceCancelId
]);
const maintenanceButtonIds = new Set([
    ...legacyMaintenanceButtonIds,
    ...maintenanceConfirmationIds
]);
const featureByCustomId = {
    palworld_start: 'start',
    palworld_stop: 'stop',
    palworld_save: 'save',
    palworld_restart: 'restart',
    palworld_refresh: 'refresh',
    [announcementButtonId]: 'announce',
    [announcementModalId]: 'announce',
    [maintenanceUpdateBotId]: 'botUpdate',
    [maintenanceUpdateBotConfirmId]: 'botUpdate',
    [maintenanceCheckUpdatesId]: 'checkUpdates',
    [maintenanceApplyUpdatesId]: 'applyUpdates',
    [maintenanceApplyUpdatesConfirmId]: 'applyUpdates'
};

function scheduleReplyDeletion(interaction, seconds = 20) {
    setTimeout(() => {
        interaction.deleteReply().catch(() => {
            // Die Nachricht wurde möglicherweise bereits gelöscht.
        });
    }, seconds * 1000);
}

async function finishReply(interaction, message, seconds = 20) {
    await interaction.editReply({
        content: message,
        components: []
    });
    scheduleReplyDeletion(interaction, seconds);
}

function createAnnouncementModal() {
    const messageInput = new TextInputBuilder()
        .setCustomId(announcementInputId)
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(t('modal.announcementPlaceholder'))
        .setMinLength(1)
        .setMaxLength(500)
        .setRequired(true);

    const label = new LabelBuilder()
        .setLabel(t('modal.announcementLabel'))
        .setTextInputComponent(messageInput);

    return new ModalBuilder()
        .setCustomId(announcementModalId)
        .setTitle(t('modal.announcementTitle'))
        .addLabelComponents(label);
}

function createConfirmationRow(confirmId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(confirmId)
            .setLabel(t('buttons.confirm'))
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(maintenanceCancelId)
            .setLabel(t('buttons.cancel'))
            .setStyle(ButtonStyle.Secondary)
    );
}

function formatCommandOutput(output, maxLength = 700) {
    const cleaned = String(output || '')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/```/g, '')
        .trim();
    const fallback = cleaned || t('maintenance.noCommandOutput');

    return fallback.length > maxLength
        ? `…\n${fallback.slice(-maxLength)}`
        : fallback;
}

function createInteractionHandler({
    guildId,
    allowedUserIds,
    ownerUserId,
    botMaintenance,
    auditLogger,
    diagnosticsService,
    serverController,
    statusMessageService,
    features = {}
}) {
    const allowedUsers = new Set(allowedUserIds);

    function audit(interaction, action, outcome = 'success', options = {}) {
        return auditLogger.log({
            action,
            outcome,
            user: interaction.user,
            ...options
        });
    }

    async function refresh(interaction) {
        const result = await statusMessageService.update();

        await audit(interaction, 'refresh', 'success', {
            details: result.updated
                ? null
                : t('interaction.statusUpdateBusy')
        });
        await finishReply(
            interaction,
            result.updated
                ? t('interaction.statusUpdated')
                : t('interaction.statusUpdateBusy')
        );
    }

    async function start(interaction) {
        await interaction.editReply(t('interaction.startProgress'));
        const result = await serverController.start();

        await audit(interaction, 'start', 'success', {
            details: result === 'already-online'
                ? t('audit.detail.alreadyOnline')
                : null
        });

        await statusMessageService.update().catch(error => {
            console.error(t('log.statusAfterStartFailed'), error);
        });
        await finishReply(
            interaction,
            result === 'already-online'
                ? t('interaction.alreadyOnline')
                : t('interaction.started')
        );
    }

    async function stop(interaction) {
        await interaction.editReply(
            t('interaction.stopProgress')
        );
        const result = await serverController.stop();

        await audit(interaction, 'stop', 'success', {
            details: result === 'already-offline'
                ? t('audit.detail.alreadyOffline')
                : null
        });

        await statusMessageService.update().catch(error => {
            console.error(t('log.statusAfterStopFailed'), error);
        });
        await finishReply(
            interaction,
            result === 'already-offline'
                ? t('interaction.alreadyOffline')
                : t('interaction.stopped')
        );
    }

    async function save(interaction) {
        await interaction.editReply(
            t('interaction.saveProgress')
        );
        await serverController.save();
        await audit(interaction, 'save');

        await statusMessageService.update().catch(error => {
            console.error(t('log.statusAfterSaveFailed'), error);
        });
        await finishReply(
            interaction,
            t('interaction.saved')
        );
    }

    async function restart(interaction) {
        await interaction.editReply(
            t('interaction.restartProgress')
        );
        await serverController.restart();
        await audit(interaction, 'restart');

        await statusMessageService.update().catch(error => {
            console.error(t('log.statusAfterRestartFailed'), error);
        });
        await finishReply(
            interaction,
            t('interaction.restarted')
        );
    }

    async function announce(interaction) {
        const message = interaction.fields.getTextInputValue(
            announcementInputId
        );

        await interaction.editReply(
            t('interaction.announcementProgress')
        );
        await serverController.announce(message);
        await audit(interaction, 'announce', 'success', {
            details: t('audit.detail.announcement', {
                length: message.trim().length
            })
        });
        await finishReply(
            interaction,
            t('interaction.announcementSent'),
            10
        );
    }

    function formatLinuxGsmStatus(status) {
        if (status.error) {
            return t('maintenance.statusUnavailable', {
                message: status.error
            });
        }

        return t('maintenance.linuxGsmStatus', {
            installed: status.installedVersion,
            latest: status.latestVersion,
            status: status.updateAvailable
                ? t('maintenance.updateAvailable')
                : t('maintenance.upToDate')
        });
    }

    async function checkUpdates(interaction) {
        await interaction.editReply(t('maintenance.checkProgress'));
        const result = await serverController.checkUpdates();

        await audit(interaction, 'checkUpdates', 'success', {
            details: t('audit.detail.updateCheck', {
                palworld: result.palworldUpdateAvailable
                    ? t('maintenance.updateAvailable')
                    : t('maintenance.upToDate'),
                linuxGsm: result.linuxGsm.error
                    ? t('maintenance.statusUnavailable', {
                        message: result.linuxGsm.error
                    })
                    : result.linuxGsm.updateAvailable
                        ? t('maintenance.updateAvailable')
                        : t('maintenance.upToDate')
            })
        });

        await finishReply(
            interaction,
            t('maintenance.checkResult', {
                palworld: formatCommandOutput(result.palworldOutput, 850),
                linuxGsm: formatLinuxGsmStatus(result.linuxGsm)
            }),
            60
        );
    }

    async function updateBot(interaction) {
        await interaction.editReply({
            content: t('maintenance.botUpdateProgress'),
            components: []
        });
        const output = await botMaintenance.updateCode();

        await audit(interaction, 'updateBot');

        await interaction.editReply({
            content: t('maintenance.botUpdateSuccess', {
                output: formatCommandOutput(output, 1_100)
            }),
            components: []
        });
        botMaintenance.schedulePm2Restart();
    }

    async function applyUpdates(interaction) {
        await interaction.editReply({
            content: t('maintenance.applyProgress'),
            components: []
        });
        const result = await serverController.applyUpdates();

        await audit(interaction, 'applyUpdates');

        await statusMessageService.update().catch(error => {
            console.error(t('log.statusUpdateFailed'), error);
        });
        await finishReply(
            interaction,
            t('maintenance.applyResult', {
                linuxGsm: formatCommandOutput(
                    result.linuxGsmOutput,
                    600
                ),
                palworld: formatCommandOutput(
                    result.palworldOutput,
                    600
                )
            }),
            60
        );
    }

    async function handleMaintenanceCommand(interaction, subcommand) {
        if (subcommand === maintenanceSubcommands.botUpdate) {
            await interaction.reply({
                content: t('maintenance.confirmBotUpdate'),
                components: [
                    createConfirmationRow(maintenanceUpdateBotConfirmId)
                ],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === maintenanceSubcommands.applyUpdates) {
            await interaction.reply({
                content: t('maintenance.confirmApplyUpdates'),
                components: [
                    createConfirmationRow(maintenanceApplyUpdatesConfirmId)
                ],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await checkUpdates(interaction);
    }

    async function handleMaintenanceConfirmation(interaction) {
        if (interaction.customId === maintenanceCancelId) {
            await interaction.update({
                content: t('maintenance.cancelled'),
                components: []
            });
            await audit(interaction, 'maintenance', 'cancelled');
            scheduleReplyDeletion(interaction);
            return;
        }

        await interaction.deferUpdate();

        if (interaction.customId === maintenanceUpdateBotConfirmId) {
            await updateBot(interaction);
            return;
        }

        await applyUpdates(interaction);
    }

    const handlers = {
        palworld_refresh: refresh,
        palworld_start: start,
        palworld_stop: stop,
        palworld_save: save,
        palworld_restart: restart
    };

    return async function handleInteraction(interaction) {
        const isDiagnosticsCommand =
            interaction.isChatInputCommand() &&
            interaction.commandName === diagnosticsCommandName;
        const isMaintenanceCommand =
            interaction.isChatInputCommand() &&
            interaction.commandName === maintenanceCommandName;
        const isAnnouncementModal =
            interaction.isModalSubmit() &&
            interaction.customId === announcementModalId;
        const isKnownButton =
            interaction.isButton() &&
            (
                interaction.customId === announcementButtonId ||
                maintenanceButtonIds.has(interaction.customId) ||
                Boolean(handlers[interaction.customId])
            );
        const isMoreActionsMenu =
            interaction.isStringSelectMenu() &&
            interaction.customId === moreActionsId;

        if (
            !isDiagnosticsCommand &&
            !isMaintenanceCommand &&
            !isAnnouncementModal &&
            !isKnownButton &&
            !isMoreActionsMenu
        ) {
            return;
        }

        if (interaction.guildId !== guildId) {
            await interaction.reply({
                content: t('interaction.wrongGuild'),
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const maintenanceSubcommand = isMaintenanceCommand
            ? interaction.options.getSubcommand()
            : null;
        const selectedAction = isMoreActionsMenu
            ? interaction.values[0]
            : null;
        const maintenanceAuditAction =
            selectedAction === checkUpdatesAction
                ? 'checkUpdates'
                : maintenanceSubcommand === maintenanceSubcommands.botUpdate
                    ? 'updateBot'
                    : maintenanceSubcommand === maintenanceSubcommands.applyUpdates
                        ? 'applyUpdates'
                        : interaction.customId === maintenanceUpdateBotConfirmId
                            ? 'updateBot'
                            : interaction.customId === maintenanceApplyUpdatesConfirmId
                                ? 'applyUpdates'
                                : 'maintenance';
        const feature = isDiagnosticsCommand
            ? 'diagnostics'
            : maintenanceSubcommand
            ? featureBySubcommand[maintenanceSubcommand]
            : selectedAction === announceAction
                ? 'announce'
                : selectedAction === checkUpdatesAction
                    ? 'checkUpdates'
                    : featureByCustomId[interaction.customId];

        if (feature && features[feature] === false) {
            await interaction.reply({
                content: t('interaction.featureDisabled'),
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (isDiagnosticsCommand) {
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({
                    content: t('maintenance.ownerOnly'),
                    flags: MessageFlags.Ephemeral
                });
                await audit(interaction, 'diagnostics', 'denied');
                return;
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            try {
                const checks = await diagnosticsService.run();
                const icons = {
                    ok: '✅',
                    warning: '⚠️',
                    error: '❌'
                };
                const lines = checks.map(check =>
                    `${icons[check.status]} **${check.name}:** ${check.detail}`
                );

                await interaction.editReply(t('diagnostics.result', {
                    checks: lines.join('\n')
                }));
                await audit(
                    interaction,
                    'diagnostics',
                    checks.some(check => check.status === 'error')
                        ? 'failed'
                        : 'success',
                    { details: lines.join('\n') }
                );
            } catch (error) {
                await interaction.editReply(t('interaction.actionFailed', {
                    message: error.message
                }));
                await audit(interaction, 'diagnostics', 'failed', { error });
            }

            return;
        }

        if (
            interaction.isButton() &&
            legacyMaintenanceButtonIds.has(interaction.customId)
        ) {
            await interaction.reply({
                content: interaction.customId === maintenanceCheckUpdatesId
                    ? t('maintenance.useActionsMenu')
                    : t('maintenance.useSlashCommand'),
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (
            isMaintenanceCommand ||
            selectedAction === checkUpdatesAction ||
            (
                interaction.isButton() &&
                maintenanceConfirmationIds.has(interaction.customId)
            )
        ) {
            if (interaction.user.id !== ownerUserId) {
                await interaction.reply({
                    content: t('maintenance.ownerOnly'),
                    flags: MessageFlags.Ephemeral
                });
                await audit(
                    interaction,
                    maintenanceAuditAction,
                    'denied'
                );
                return;
            }

            try {
                if (selectedAction === checkUpdatesAction) {
                    await interaction.deferReply({
                        flags: MessageFlags.Ephemeral
                    });
                    await checkUpdates(interaction);
                } else if (isMaintenanceCommand) {
                    await handleMaintenanceCommand(
                        interaction,
                        maintenanceSubcommand
                    );
                } else {
                    await handleMaintenanceConfirmation(interaction);
                }
            } catch (error) {
                console.error(t('log.interactionFailed', {
                    customId: interaction.customId ||
                        `/${maintenanceCommandName} ${maintenanceSubcommand}`
                }), error);

                const isBusy =
                    error instanceof MaintenanceBusyError ||
                    error instanceof ServerActionBusyError;
                const message = isBusy
                    ? t('interaction.actionBusy')
                    : t('interaction.actionFailed', {
                        message: error.message
                    });

                await audit(
                    interaction,
                    maintenanceAuditAction,
                    'failed',
                    { error }
                );

                if (interaction.deferred || interaction.replied) {
                    await finishReply(interaction, message).catch(() => {});
                } else {
                    await interaction.reply({
                        content: message,
                        flags: MessageFlags.Ephemeral
                    }).catch(() => {});
                }

                await statusMessageService.update().catch(() => {});
            }

            return;
        }

        if (!allowedUsers.has(interaction.user.id)) {
            await interaction.reply({
                content: t('interaction.notAllowed'),
                flags: MessageFlags.Ephemeral
            });
            await audit(interaction, 'serverControl', 'denied');
            return;
        }

        if (
            (
                interaction.isButton() &&
                interaction.customId === announcementButtonId
            ) || selectedAction === announceAction
        ) {
            await interaction.showModal(createAnnouncementModal());
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (isAnnouncementModal) {
                await announce(interaction);
            } else {
                await handlers[interaction.customId](interaction);
            }
        } catch (error) {
            console.error(t('log.interactionFailed', {
                customId: interaction.customId
            }), error);

            const message = error instanceof ServerActionBusyError
                ? t('interaction.actionBusy')
                : t('interaction.actionFailed', {
                    message: error.message
                });

            const failedAction = isAnnouncementModal
                ? 'announce'
                : {
                    palworld_start: 'start',
                    palworld_stop: 'stop',
                    palworld_save: 'save',
                    palworld_restart: 'restart',
                    palworld_refresh: 'refresh'
                }[interaction.customId] || 'serverControl';

            await audit(interaction, failedAction, 'failed', { error });

            await finishReply(
                interaction,
                message,
                isAnnouncementModal ? 10 : 20
            ).catch(() => {});
            await statusMessageService.update().catch(() => {});
        }
    };
}

module.exports = {
    createInteractionHandler
};
