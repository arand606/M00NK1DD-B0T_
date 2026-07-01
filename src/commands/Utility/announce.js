import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

const EPHEMERAL = 1 << 6;

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
      // Safer member permission handling across interaction contexts
      const memberPerms = interaction.memberPermissions ?? interaction.member?.permissions;
      if (!memberPerms?.has(PermissionFlagsBits.ManageGuild)) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Permission Denied', 'You need the **Manage Server** permission to use this command.')],
          flags: EPHEMERAL,
        });
      }

      const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
      const rawMessage = interaction.options.getString('message');
      const messageText = rawMessage ? rawMessage.trim() : '';
      const pingRole = interaction.options.getRole('role');
      const mentionEveryone = interaction.options.getBoolean('everyone');

      if (!messageText) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Invalid Message', 'Please provide a non-empty announcement message.')],
          flags: EPHEMERAL,
        });
      }

      if (!targetChannel || !targetChannel.isTextBased()) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Invalid Channel', 'Please provide a valid text channel to send the announcement in.')],
          flags: EPHEMERAL,
        });
      }

      const botMember = interaction.guild?.members?.me ?? null;
      const botPerms = botMember ? targetChannel.permissionsFor(botMember) : targetChannel.permissionsFor(client.user?.id);
      if (!botPerms?.has(PermissionFlagsBits.SendMessages)) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Missing Permission', `I don't have permission to send messages in ${targetChannel}.`)],
          flags: EPHEMERAL,
        });
      }

      // Build the announcement content and allowedMentions safely
      let prefix = '';
      const allowedMentions = { parse: [] };

      if (pingRole) {
        prefix = `<@&${pingRole.id}> `;
        // allow only that role to be mentioned (prevents accidental pings)
        allowedMentions.roles = [pingRole.id];
      } else if (mentionEveryone) {
        // Check bot has mention everyone permission
        if (!botPerms.has(PermissionFlagsBits.MentionEveryone)) {
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Missing Permission', "I don't have permission to mention @everyone in that channel.")],
            flags: EPHEMERAL,
          });
        }
        prefix = '@everyone ';
        allowedMentions.parse = ['everyone'];
      }

      // Send the announcement
      const sentMessage = await targetChannel.send({ content: `${prefix}${messageText}`, allowedMentions });

      // If the channel is a News/Announcement channel, try to crosspost so followers receive it
      if (targetChannel.type === ChannelType.GuildAnnouncement && typeof sentMessage.crosspost === 'function') {
        try {
          await sentMessage.crosspost();
        } catch (e) {
          logger.warn('Failed to crosspost announcement:', e);
        }
      }

      const success = successEmbed('Announcement Sent', `Your announcement was sent in ${targetChannel}.`);
      if (typeof success.addFields === 'function') {
        success.addFields({ name: 'Link', value: `[Jump to message](${sentMessage.url})` });
      }

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [success],
        flags: EPHEMERAL,
      });

      logger.info(`Announcement sent by ${interaction.user.tag} in ${interaction.guildId} -> ${targetChannel.id}`);
    } catch (error) {
      logger.error('Announce command error:', error);
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [errorEmbed('Failed to Send', 'An unexpected error occurred while sending the announcement.')],
        flags: EPHEMERAL,
      });
    }
  }
};
