import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Make the bot send an announcement message. (Manage Server required)')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send the announcement in. Defaults to the current channel.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The announcement message to send')
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Optional role to mention in the announcement')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('everyone')
        .setDescription('If true, mention @everyone in the announcement')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  category: 'utility',

  async execute(interaction, config, client) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) {
      logger.warn(`Announce interaction defer failed`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'announce'
      });
      return;
    }

    try {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Permission Denied', 'You need the **Manage Server** permission to use this command.')],
          flags: 1 << 6, // Ephemeral
        });
      }

      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
      const messageText = interaction.options.getString('message').trim();
      const pingRole = interaction.options.getRole('role');
      const mentionEveryone = interaction.options.getBoolean('everyone');

      if (!targetChannel || !targetChannel.isTextBased()) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Invalid Channel', 'Please provide a valid text channel to send the announcement in.')],
          flags: 1 << 6,
        });
      }

      const botMember = interaction.guild.members.me;
      const botPerms = targetChannel.permissionsFor(botMember);
      if (!botPerms || !botPerms.has([PermissionFlagsBits.SendMessages])) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Missing Permission', `I don't have permission to send messages in ${targetChannel}.`)],
          flags: 1 << 6,
        });
      }

      // Build the announcement content
      let prefix = '';
      if (pingRole) {
        prefix = `<@&${pingRole.id}> `;
      } else if (mentionEveryone) {
        // Check bot has mention everyone permission
        if (!botPerms.has(PermissionFlagsBits.MentionEveryone)) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Missing Permission', "I don't have permission to mention @everyone in that channel.")],
            flags: 1 << 6,
          });
        }
        prefix = '@everyone ';
      }

      // Send the announcement
      const sentMessage = await targetChannel.send({ content: `${prefix}${messageText}` });

      const success = successEmbed('Announcement Sent', `Your announcement was sent in ${targetChannel}.`);
      success.addFields ? success.addFields({ name: 'Link', value: `[Jump to message](${sentMessage.url})` }) : null;

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [success],
        flags: 1 << 6,
      });

      logger.info(`Announcement sent by ${interaction.user.tag} in ${interaction.guildId} -> ${targetChannel.id}`);
    } catch (error) {
      logger.error('Announce command error:', error);
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [errorEmbed('Failed to Send', 'An unexpected error occurred while sending the announcement.')],
        flags: 1 << 6,
      });
    }
  }
};
