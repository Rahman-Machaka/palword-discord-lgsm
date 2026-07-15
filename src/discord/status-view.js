const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    SeparatorBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    escapeMarkdown
} = require('discord.js');
const { t } = require('../i18n.js');

const statusColors = {
    online: 0x2ecc71,
    offline: 0xe74c3c,
    unavailable: 0xf39c12
};

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const parts = [];

    if (days > 0) {
        parts.push(t('duration.days', { value: days }));
    }

    if (hours > 0 || days > 0) {
        parts.push(t('duration.hours', { value: hours }));
    }

    parts.push(t('duration.minutes', { value: minutes }));
    return parts.join(' ');
}

function createButton(customId, label, emoji, style, disabled = false) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(style)
        .setDisabled(disabled);
}

function createPalworldControls(status, actionRunning = false, features = {}) {
    const isEnabled = feature => features[feature] !== false;
    const buttons = [];
    const rows = [];

    if (status.state === 'offline' && isEnabled('start')) {
        buttons.push(createButton(
            'palworld_start',
            t('buttons.start'),
            '▶️',
            ButtonStyle.Success,
            actionRunning
        ));
    }

    if (status.state === 'online') {
        if (isEnabled('save')) {
            buttons.push(createButton(
                'palworld_save',
                t('buttons.save'),
                '💾',
                ButtonStyle.Primary,
                actionRunning
            ));
        }

        if (isEnabled('restart')) {
            buttons.push(createButton(
                'palworld_restart',
                t('buttons.restart'),
                '♻️',
                ButtonStyle.Primary,
                actionRunning
            ));
        }

        if (isEnabled('stop')) {
            buttons.push(createButton(
                'palworld_stop',
                t('buttons.stop'),
                '⏹️',
                ButtonStyle.Danger,
                actionRunning
            ));
        }

    }

    if (isEnabled('refresh')) {
        buttons.push(createButton(
            'palworld_refresh',
            t('buttons.refresh'),
            '🔄',
            ButtonStyle.Secondary
        ));
    }

    if (buttons.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(buttons));
    }

    const options = [];

    if (status.state === 'online' && isEnabled('announce')) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(t('buttons.announce'))
            .setDescription(t('actions.announceDescription'))
            .setEmoji('📢')
            .setValue('announce'));
    }

    if (isEnabled('checkUpdates')) {
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(t('actions.checkUpdates'))
            .setDescription(t('actions.checkUpdatesDescription'))
            .setEmoji('🔎')
            .setValue('check_updates'));
    }

    if (options.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('palworld_more_actions')
                .setPlaceholder(t('actions.placeholder'))
                .setDisabled(actionRunning)
                .addOptions(options)
        ));
    }

    return rows;
}

function createOnlineContent(status) {
    const serverName = escapeMarkdown(String(status.serverName));
    const playerNames = status.players
        .map(player => {
            const name = escapeMarkdown(String(
                player.name || t('status.unknownPlayer')
            ));
            const level = player.level ?? t('status.unknownLevel');
            return t('status.playerLine', { name, level });
        })
        .slice(0, 20);

    return [
        new TextDisplayBuilder().setContent(
            `# ${t('status.onlineTitle', { serverName })}\n` +
            t('status.onlineDescription')
        ),
        new SeparatorBuilder().setDivider(true),
        new TextDisplayBuilder().setContent(t('status.dashboardOverview', {
            playersLabel: t('status.players'),
            players: t('status.playerCount', {
                current: status.currentPlayers,
                max: status.maxPlayers
            }),
            fpsLabel: t('status.serverFps'),
            fps: status.serverFps,
            dayLabel: t('status.worldDay'),
            day: status.days,
            uptimeLabel: t('status.uptime'),
            uptime: formatDuration(status.uptime),
            versionLabel: t('status.version'),
            version: escapeMarkdown(String(status.version))
        })),
        new SeparatorBuilder().setDivider(true),
        new TextDisplayBuilder().setContent(t('status.dashboardPlayers', {
            heading: t('status.onlinePlayers'),
            players: playerNames.length > 0
                ? playerNames.join('\n')
                : t('status.noPlayers')
        }))
    ];
}

function createStateContent(status) {
    if (status.state === 'online') {
        return createOnlineContent(status);
    }

    if (status.state === 'offline') {
        return [new TextDisplayBuilder().setContent(
            `# ${t('status.offlineTitle')}\n${t('status.offlineDescription')}`
        )];
    }

    return [new TextDisplayBuilder().setContent(
        `# ${t('status.unavailableTitle')}\n` +
        `${t('status.unavailableDescription')}\n\n` +
        `**${t('status.error')}:** ` +
        escapeMarkdown(String(status.error || t('status.unknownError')))
    )];
}

function createStatusDashboard(status, actionRunning = false, features = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const state = statusColors[status.state]
        ? status.state
        : 'unavailable';
    const container = new ContainerBuilder()
        .setAccentColor(statusColors[state])
        .spliceComponents(0, 0, ...createStateContent(status))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            t('status.dashboardUpdated', {
                label: t('status.lastUpdate'),
                timestamp,
                footer: features.autoStatusUpdates === false
                    ? t('status.footerManual')
                    : t('status.footer')
            })
        ));
    const controls = createPalworldControls(
        status,
        actionRunning,
        features
    );

    if (controls.length > 0) {
        container.addActionRowComponents(controls);
    }

    return container;
}

module.exports = {
    createPalworldControls,
    createStatusDashboard,
    formatDuration
};
