const { SlashCommandBuilder } = require('discord.js');
const { t } = require('../i18n.js');

const maintenanceCommandName = 'maintenance';
const diagnosticsCommandName = 'diagnostics';
const maintenanceSubcommands = {
    botUpdate: 'update-bot',
    applyUpdates: 'install-updates'
};
const featureBySubcommand = Object.fromEntries(
    Object.entries(maintenanceSubcommands)
        .map(([feature, subcommand]) => [subcommand, feature])
);

function createGuildCommands(features = {}) {
    const commands = [];
    const enabledSubcommands = Object.entries(maintenanceSubcommands)
        .filter(([feature]) => features[feature] !== false);

    if (enabledSubcommands.length > 0) {
        const command = new SlashCommandBuilder()
            .setName(maintenanceCommandName)
            .setDescription(t('commands.maintenanceDescription'));

        for (const [feature, name] of enabledSubcommands) {
            command.addSubcommand(subcommand => subcommand
                .setName(name)
                .setDescription(t(`commands.${feature}Description`))
            );
        }

        commands.push(command.toJSON());
    }

    if (features.diagnostics !== false) {
        commands.push(new SlashCommandBuilder()
            .setName(diagnosticsCommandName)
            .setDescription(t('commands.diagnosticsDescription'))
            .toJSON());
    }

    return commands;
}

module.exports = {
    createGuildCommands,
    diagnosticsCommandName,
    featureBySubcommand,
    maintenanceCommandName,
    maintenanceSubcommands
};
