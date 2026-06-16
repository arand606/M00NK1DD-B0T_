import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
  data: new SlashCommandBuilder()
    .setName("unquarantine-user")
    .setDescription("Remove quarantine from a user - restores their messaging privileges")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user to unquarantine")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Reason for removing quarantine"),
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
      const reason = interaction.options.getString("reason") || "Quarantine lifted";

      // Validation checks
      if (!member) {
        throw new TitanBotError(
          "Target not found",
          ErrorTypes.USER_INPUT,
          "The target user is not currently in this server.",
          { subtype: 'user_not_found' }
        );
      }

      await interaction.deferReply();

      // Remove quarantine by clearing all permission overrides for this user
      const guild = interaction.guild;
      let channelsModified = 0;
      const failedChannels = [];

      for (const [, channel] of guild.channels.cache) {
        try {
          // Skip voice channels and thread channels
          if (channel.isDMBased() || channel.isThread()) {
            continue;
          }

          // Check if there's an existing permission override for this user
          const memberPermissions = channel.permissionOverwrites.get(targetUser.id);
          
          if (memberPermissions) {
            // Delete the permission override for this user
            await channel.permissionOverwrites.delete(targetUser.id, `Unquarantine: ${reason}`);
            channelsModified++;
          }
        } catch (error) {
          logger.warn(`Failed to remove quarantine from channel ${channel.name}:`, error);
          failedChannels.push(channel.name);
        }
      }

      // Log the moderation action
      const caseId = await logModerationAction({
        client,
        guild: interaction.guild,
        event: {
          action: "User Unquarantined",
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
      let description = `**Reason:** ${reason}\n**Case ID:** #${caseId}\n**Channels Modified:** ${channelsModified}`;
      if (failedChannels.length > 0) {
        description += `\n⚠️ **Failed to modify:** ${failedChannels.join(', ')}`;
      }

      await InteractionHelper.universalReply(interaction, {
        embeds: [
          successEmbed(
            `🔓 **Unquarantined** ${targetUser.tag}`,
            description,
          ),
        ],
      });

      logger.info(`User ${targetUser.tag} unquarantined in ${guild.name} by ${interaction.user.tag}`);
    } catch (error) {
      logger.error('Unquarantine user command error:', error);
      const errorEmbed_default = errorEmbed(
        "An unexpected error occurred while trying to unquarantine the user.",
        error.message || "Could not unquarantine the user"
      );
      await InteractionHelper.universalReply(interaction, { embeds: [errorEmbed_default] });
    }
  }
};
