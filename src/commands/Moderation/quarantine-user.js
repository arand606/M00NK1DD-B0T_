import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName("quarantine-user")
    .setDescription("Quarantine a user - restricts their messaging privileges across the server")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user to quarantine")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for quarantine"),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: "moderation",

  async execute(interaction, config, client) {
    try {
      // Permission check
      if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw new TitanBotError(
          "User lacks permission",
          ErrorTypes.PERMISSION,
          "You do not have permission to moderate members."
        );
      }

      const targetUser = interaction.options.getUser("target");
      const member = interaction.options.getMember("target");
      const reason = interaction.options.getString("reason") || "User quarantined";

      // Validation checks
      if (!member) {
        throw new TitanBotError(
          "Target not found",
          ErrorTypes.USER_INPUT,
          "The target user is not currently in this server.",
          { subtype: 'user_not_found' }
        );
      }

      // Check if user is trying to quarantine themselves
      if (targetUser.id === interaction.user.id) {
        throw new TitanBotError(
          "Invalid target",
          ErrorTypes.USER_INPUT,
          "You cannot quarantine yourself."
        );
      }

      // Check if user is trying to quarantine a bot
      if (targetUser.bot) {
        throw new TitanBotError(
          "Invalid target",
          ErrorTypes.USER_INPUT,
          "You cannot quarantine bots."
        );
      }

      await interaction.deferReply();

      // Quarantine by denying send messages permission across all channels
      const guild = interaction.guild;
      let channelsModified = 0;
      const failedChannels = [];

      for (const [, channel] of guild.channels.cache) {
        try {
          // Skip DM channels and threads
          if (channel.isDMBased() || channel.isThread()) {
            continue;
          }

          // Skip voice channels
          if (channel.type === ChannelType.GuildVoice) {
            continue;
          }

          // Set deny permissions for sending messages
          await channel.permissionOverwrites.edit(
            targetUser.id,
            {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false
            },
            `Quarantine: ${reason}`
          );
          channelsModified++;
        } catch (error) {
          logger.warn(`Failed to quarantine user in channel ${channel.name}:`, error);
          failedChannels.push(channel.name);
        }
      }

      // Log the moderation action
      const caseId = await logModerationAction({
        client,
        guild: interaction.guild,
        event: {
          action: "User Quarantined",
          target: `${targetUser.tag} (${targetUser.id})`,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          reason,
          metadata: {
            userId: targetUser.id,
            moderatorId: interaction.user.id,
            channelsModified,
            failedChannels: failedChannels.length > 0 ? failedChannels.join(', ') : 'none'
          }
        }
      });

      // Prepare response message
      let description = `**Target:** ${targetUser.tag}\n**Reason:** ${reason}\n**Case ID:** #${caseId}\n**Channels Modified:** ${channelsModified}`;
      if (failedChannels.length > 0) {
        description += `\n⚠️ **Failed to modify:** ${failedChannels.join(', ')}`;
      }

      await InteractionHelper.universalReply(interaction, {
        embeds: [
          successEmbed(
            `🔒 **Quarantined** ${targetUser.tag}`,
            description,
          ),
        ],
      });

      logger.info(`User ${targetUser.tag} quarantined in ${guild.name} by ${interaction.user.tag}`);
    } catch (error) {
      logger.error('Quarantine user command error:', error);
      const errorEmbed_default = errorEmbed(
        "An unexpected error occurred while trying to quarantine the user.",
        error.message || "Could not quarantine the user"
      );
      await InteractionHelper.universalReply(interaction, { embeds: [errorEmbed_default] });
    }
  }
};